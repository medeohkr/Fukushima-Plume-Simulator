# prepare_HYCOM_daily_FIXED.py
"""
DAILY HYCOM Converter - FIXED VERSION for surface data
Assumes data is already daily with one timestep per day.
"""

import xarray as xr
import numpy as np
import struct
import os
from pathlib import Path
import re
from datetime import datetime, timedelta
import json
import sys

# === CONFIGURATION ===
DATA_DIR = "web/data/hycom_data"
OUTPUT_DIR = "web/data/currents_daily_bin"
BINARY_VERSION = 3
BASE_DATE = datetime(2011, 3, 1)


def find_and_sort_hycom_files(data_dir):
    """Find and sort all HYCOM .nc4 files in directory."""
    files = []
    base_pattern = re.compile(r'^expt_90_2011\.nc4$')
    numbered_pattern = re.compile(r'^expt_90_2011\((\d+)\)\.nc4$')

    for filepath in Path(data_dir).glob("*.nc4"):
        filename = filepath.name
        if base_pattern.match(filename):
            files.append((-1, filepath))
        else:
            match = numbered_pattern.match(filename)
            if match:
                files.append((int(match.group(1)), filepath))

    files.sort(key=lambda x: x[0])
    return files


def get_daily_time_slices(dataset):
    """
    For HYCOM surface data: one timestep = one day.
    Returns list of (day_offset, time_index) for each day.
    """
    print("  Analyzing time dimension...")

    # Find time variable
    time_var = None
    for name in ['MT', 'time', 'Time']:
        if name in dataset.variables:
            time_var = dataset[name]
            print(f"  Using time variable: {name}")
            break

    if time_var is None:
        print("  ⚠️ No time variable found, assuming 1 day per file")
        return [(0, 0)]

    time_values = time_var.values
    print(f"  Found {len(time_values)} timesteps")

    # Parse dates from time values
    daily_slices = []
    for i, time_val in enumerate(time_values):
        try:
            # Try to parse as numpy datetime64
            if hasattr(time_val, 'item'):
                dt = time_val.item()
                if isinstance(dt, np.datetime64):
                    dt = datetime.utcfromtimestamp(dt.astype('datetime64[s]').astype('int'))
                elif isinstance(dt, datetime):
                    pass  # Already datetime
                else:
                    dt = datetime.strptime(str(time_val)[:10], '%Y-%m-%d')
            else:
                dt = datetime.strptime(str(time_val)[:10], '%Y-%m-%d')

            day_offset = (dt.date() - BASE_DATE.date()).days
            daily_slices.append((day_offset, i))
            print(f"    Timestep {i}: {dt.date()} (day offset: {day_offset})")

        except Exception as e:
            print(f"    ⚠️ Could not parse timestep {i}: {time_val} - {e}")
            # Fallback: use file order
            daily_slices.append((i, i))

    return daily_slices


def extract_single_day_data(dataset, time_index):
    """
    Extract surface currents for a single timestep.
    Handles both 3D (time, lat, lon) and 4D (time, depth, lat, lon) data.
    """
    print(f"  Extracting timestep {time_index}...")

    # Get coordinates (constant)
    lon_2d = dataset['Longitude'].values
    lat_2d = dataset['Latitude'].values

    # Get velocity data
    u_data = dataset['u']
    v_data = dataset['v']

    u_values = u_data.values
    v_values = v_data.values

    # DEBUG: Print shape info
    print(f"    U shape: {u_values.shape}")
    print(f"    V shape: {v_values.shape}")

    # Handle different dimension orders
    if u_values.ndim == 4:
        # Shape: (time, depth, lat, lon)
        print("    4D data detected - extracting surface layer (depth=0)")
        u_daily = u_values[time_index, 0, :, :]
        v_daily = v_values[time_index, 0, :, :]

    elif u_values.ndim == 3:
        # Shape: (time, lat, lon) - already surface
        print("    3D surface data detected")
        u_daily = u_values[time_index, :, :]
        v_daily = v_values[time_index, :, :]

    elif u_values.ndim == 2:
        # Shape: (lat, lon) - single timestep
        print("    2D data detected - single day file")
        u_daily = u_values
        v_daily = v_values

    else:
        raise ValueError(f"Unexpected data shape: {u_values.shape}")

    # Handle NaN values (land mask)
    u_daily = np.where(np.isnan(u_daily), np.nan, u_daily)
    v_daily = np.where(np.isnan(v_daily), np.nan, v_daily)

    print(f"    U range: [{np.nanmin(u_daily):.6f}, {np.nanmax(u_daily):.6f}] m/s")
    print(f"    V range: [{np.nanmin(v_daily):.6f}, {np.nanmax(v_daily):.6f}] m/s")

    return u_daily, v_daily, lon_2d, lat_2d


def write_daily_binary(u_data, v_data, lon_data, lat_data, year, month, day, output_dir):
    """Write daily data to binary format."""
    os.makedirs(output_dir, exist_ok=True)

    n_lat, n_lon = u_data.shape
    filename = f"currents_{year}_{month:02d}_{day:02d}.bin"
    filepath = os.path.join(output_dir, filename)

    print(f"  Writing: {filename} ({n_lat}x{n_lon})")

    with open(filepath, 'wb') as f:
        header = struct.pack('6i', BINARY_VERSION, n_lat, n_lon, year, month, day)
        f.write(header)
        f.write(np.ascontiguousarray(lon_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(lat_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(u_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(v_data, dtype=np.float32).tobytes())

    return filename


def main():
    """Main conversion function."""
    print("=" * 70)
    print("DAILY HYCOM CONVERTER - FIXED VERSION")
    print("=" * 70)

    sorted_files = find_and_sort_hycom_files(DATA_DIR)
    if not sorted_files:
        print(f"❌ No .nc4 files found in {DATA_DIR}")
        sys.exit(1)

    print(f"Found {len(sorted_files)} HYCOM files")
    processed_days = []

    for file_index, filepath in sorted_files:
        print(f"\n{'=' * 50}")
        print(f"Processing: {filepath.name}")

        try:
            ds = xr.open_dataset(filepath)

            # Get daily slices (one per timestep)
            daily_slices = get_daily_time_slices(ds)

            for day_offset, time_index in daily_slices:
                target_date = BASE_DATE + timedelta(days=day_offset)
                year, month, day = target_date.year, target_date.month, target_date.day

                print(f"\n  Day {day_offset + 1}: {year}-{month:02d}-{day:02d}")
                print(f"    Time index: {time_index}")

                # Extract data for this timestep
                u_daily, v_daily, lon_2d, lat_2d = extract_single_day_data(ds, time_index)

                # Write to binary
                filename = write_daily_binary(u_daily, v_daily, lon_2d, lat_2d,
                                              year, month, day, OUTPUT_DIR)

                processed_days.append({
                    'year': year, 'month': month, 'day': day,
                    'date_str': f"{year}-{month:02d}-{day:02d}",
                    'day_offset': day_offset,
                    'file': filename,
                    'lat_size': u_daily.shape[0],
                    'lon_size': u_daily.shape[1],
                    'lon_range': [float(lon_2d.min()), float(lon_2d.max())],
                    'lat_range': [float(lat_2d.min()), float(lat_2d.max())]
                })

                print(f"    ✅ Saved: {filename}")

            ds.close()

        except Exception as e:
            print(f"❌ Error: {e}")
            import traceback
            traceback.print_exc()

    # Create metadata
    if processed_days:
        metadata = {
            'description': 'Daily HYCOM surface currents',
            'binary_version': BINARY_VERSION,
            'base_date': BASE_DATE.isoformat(),
            'days': processed_days
        }

        metadata_path = os.path.join(OUTPUT_DIR, "currents_daily_metadata.json")
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"\n{'=' * 70}")
        print(f"✅ Processed {len(processed_days)} daily files")
        print(f"Date range: {processed_days[0]['date_str']} to {processed_days[-1]['date_str']}")
        print(f"Metadata: {metadata_path}")

        # Show first 5 files
        print(f"\n📊 First 5 files:")
        for info in processed_days[:5]:
            print(f"  {info['date_str']}: {info['file']}")


if __name__ == "__main__":
    main()