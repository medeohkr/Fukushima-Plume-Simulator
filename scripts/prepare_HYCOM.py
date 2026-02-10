# prepare_HYCOM_3D_FIXED.py
"""
FIXED VERSION for HYCOM data with shape (MT=1, Depth=1, Y=1793, X=2324)
"""

import xarray as xr
import numpy as np
import struct
import os
from pathlib import Path
from datetime import datetime, timedelta
import json
import sys
import re

# === CONFIGURATION ===
DATA_DIR = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/data/hycom_3d/"
OUTPUT_DIR = "data/currents_3d_bin"
BINARY_VERSION = 4
BASE_DATE = datetime(2011, 3, 1)
DEPTH_LEVELS = [0.0, 50.0, 100.0, 200.0, 500.0, 1000.0]


def find_daily_directories(data_dir):
    """Find all date directories (YYYYMMDD format)."""
    dirs = []
    date_pattern = re.compile(r'^\d{8}$')  # YYYYMMDD

    for item in Path(data_dir).iterdir():
        if item.is_dir() and date_pattern.match(item.name):
            try:
                date_str = item.name
                date = datetime.strptime(date_str, "%Y%m%d")
                dirs.append((date, item))
            except ValueError:
                print(f"⚠️ Skipping invalid date directory: {item.name}")

    dirs.sort(key=lambda x: x[0])
    return dirs


def find_depth_files_for_date(date_dir):
    """Find all depth files for a specific date directory."""
    depth_files = {}

    depth_pattern = re.compile(r'^hycom_\d{8}_depth(\d+(?:\.\d+)?)m\.nc$')

    for filepath in date_dir.glob("*.nc"):
        filename = filepath.name
        match = depth_pattern.match(filename)

        if match:
            depth = float(match.group(1))
            depth_files[depth] = filepath

    return depth_files


def extract_single_depth_data(nc_filepath, depth):
    """
    CORRECTED for HYCOM shape: (MT=1, Depth=1, Y=1793, X=2324)
    """
    print(f"    Extracting depth {depth}m...")

    try:
        ds = xr.open_dataset(nc_filepath)

        # DEBUG: Show dimensions
        print(f"      Dimensions: {dict(ds.dims)}")

        # Get u and v - squeeze MT and Depth dimensions
        u_2d = ds['u'].values[0, 0, :, :]  # Shape: (Y, X)
        v_2d = ds['v'].values[0, 0, :, :]  # Shape: (Y, X)

        # Get 2D coordinate grids
        lon_2d = ds['Longitude'].values  # Shape: (Y, X)
        lat_2d = ds['Latitude'].values  # Shape: (Y, X)

        print(f"      U shape: {u_2d.shape}")
        print(f"      Lon shape: {lon_2d.shape}, range: [{lon_2d.min():.1f}, {lon_2d.max():.1f}]")
        print(f"      Lat shape: {lat_2d.shape}, range: [{lat_2d.min():.1f}, {lat_2d.max():.1f}]")
        print(f"      U range: [{np.nanmin(u_2d):.4f}, {np.nanmax(u_2d):.4f}] m/s")

        ds.close()

        # Handle NaN
        u_2d = np.where(np.isnan(u_2d), np.nan, u_2d)
        v_2d = np.where(np.isnan(v_2d), np.nan, v_2d)

        return u_2d, v_2d, lon_2d, lat_2d

    except Exception as e:
        print(f"    ❌ Error reading {nc_filepath.name}: {e}")
        import traceback
        traceback.print_exc()
        return None, None, None, None


def combine_depth_layers_for_date(date_dir, target_depths):
    """
    Combine all depth files for a date into a single 3D array.
    """
    print(f"  Combining depths for {date_dir.name}...")

    # Find all depth files
    depth_files = find_depth_files_for_date(date_dir)

    if not depth_files:
        print(f"  ❌ No depth files found in {date_dir}")
        return None, None, None, None, None

    print(f"  Found {len(depth_files)} depth files")

    # Check available depths
    available_depths = sorted([d for d in target_depths if d in depth_files])
    missing = [d for d in target_depths if d not in depth_files]

    if missing:
        print(f"  ⚠️ Missing depths: {missing}")

    if not available_depths:
        print(f"  ❌ No target depths available")
        return None, None, None, None, None

    print(f"  Processing depths: {available_depths}")

    # Process first depth to get dimensions
    first_depth = available_depths[0]
    first_u, first_v, first_lon, first_lat = extract_single_depth_data(
        depth_files[first_depth], first_depth
    )

    if first_u is None:
        print(f"  ❌ Failed to read first depth {first_depth}")
        return None, None, None, None, None

    n_lat, n_lon = first_u.shape
    n_depth = len(available_depths)

    print(f"  Grid size: {n_lat}x{n_lon}, Depth layers: {n_depth}")

    # Initialize 3D arrays
    u_3d = np.zeros((n_depth, n_lat, n_lon), dtype=np.float32)
    v_3d = np.zeros((n_depth, n_lat, n_lon), dtype=np.float32)

    # Store coordinates
    lon_2d = first_lon
    lat_2d = first_lat

    # Fill first layer
    u_3d[0] = first_u
    v_3d[0] = first_v

    # Process remaining depths
    for i, depth in enumerate(available_depths[1:], 1):
        print(f"    Processing depth {depth}m ({i + 1}/{n_depth})...")
        u_2d, v_2d, lon_check, lat_check = extract_single_depth_data(
            depth_files[depth], depth
        )

        if u_2d is None:
            print(f"    ⚠️ Depth {depth}m failed, filling with NaN")
            u_3d[i] = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
            v_3d[i] = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
        else:
            # Verify shape matches
            if u_2d.shape != (n_lat, n_lon):
                print(f"    ⚠️ Shape mismatch: {u_2d.shape} vs {n_lat}x{n_lon}")
                print(f"    Filling with NaN")
                u_3d[i] = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
                v_3d[i] = np.full((n_lat, n_lon), np.nan, dtype=np.float32)
            else:
                u_3d[i] = u_2d
                v_3d[i] = v_2d

    return u_3d, v_3d, lon_2d, lat_2d, available_depths


def write_3d_binary(u_data, v_data, lon_data, lat_data, year, month, day, depths, output_dir):
    """Write 3D daily data to binary format (Version 4)."""
    os.makedirs(output_dir, exist_ok=True)

    n_depth, n_lat, n_lon = u_data.shape
    total_cells = n_lat * n_lon

    filename = f"currents_{year}_{month:02d}_{day:02d}.bin"
    filepath = os.path.join(output_dir, filename)

    print(f"  Writing: {filename} ({n_lat}x{n_lon}x{n_depth})")
    print(f"    Depths: {depths}")
    print(f"    Total cells: {total_cells:,}")
    print(f"    Total data points: {total_cells * n_depth:,}")

    # Count NaN values
    nan_count_u = np.sum(np.isnan(u_data))
    nan_count_v = np.sum(np.isnan(v_data))
    total_points = u_data.size

    print(f"    NaN values: U={nan_count_u:,} ({nan_count_u / total_points:.1%}), "
          f"V={nan_count_v:,} ({nan_count_v / total_points:.1%})")

    with open(filepath, 'wb') as f:
        # Version 4 header: 7 integers
        header = struct.pack('7i', BINARY_VERSION, n_lat, n_lon, n_depth,
                             year, month, day)
        f.write(header)

        # Write coordinates (2D, same for all depths)
        f.write(np.ascontiguousarray(lon_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(lat_data, dtype=np.float32).tobytes())

        # Write 3D velocity data
        u_flat = u_data.reshape(-1).astype(np.float32)
        v_flat = v_data.reshape(-1).astype(np.float32)

        # Replace NaN with a large negative number for binary storage
        u_flat[np.isnan(u_flat)] = -9999.0
        v_flat[np.isnan(v_flat)] = -9999.0

        f.write(u_flat.tobytes())
        f.write(v_flat.tobytes())

    file_size = os.path.getsize(filepath)
    print(f"    File size: {file_size / (1024 ** 2):.1f} MB")

    return filename


def main():
    """Main conversion function."""
    print("=" * 70)
    print("3D HYCOM CONVERTER - FIXED VERSION")
    print("=" * 70)
    print(f"Data directory: {DATA_DIR}")
    print(f"Target depths: {DEPTH_LEVELS}")

    # Find all date directories
    daily_dirs = find_daily_directories(DATA_DIR)
    if not daily_dirs:
        print(f"❌ No date directories found in {DATA_DIR}")
        sys.exit(1)

    print(f"Found {len(daily_dirs)} date directories")
    print(f"Date range: {daily_dirs[0][0].date()} to {daily_dirs[-1][0].date()}")

    processed_days = []
    skipped_days = []

    for date_obj, date_dir in daily_dirs:
        year, month, day = date_obj.year, date_obj.month, date_obj.day
        day_offset = (date_obj.date() - BASE_DATE.date()).days

        print(f"\n{'=' * 50}")
        print(f"Processing: {date_dir.name} ({year}-{month:02d}-{day:02d})")
        print(f"Day offset: {day_offset}")

        # Check if output already exists
        output_filename = f"currents_{year}_{month:02d}_{day:02d}.bin"
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        if os.path.exists(output_path):
            print(f"  ⚠️ Output already exists, skipping...")
            processed_days.append({
                'year': year, 'month': month, 'day': day,
                'date_str': f"{year}-{month:02d}-{day:02d}",
                'day_offset': day_offset,
                'file': output_filename,
                'skipped': True
            })
            continue

        # Combine depth layers for this date
        u_3d, v_3d, lon_2d, lat_2d, actual_depths = combine_depth_layers_for_date(
            date_dir, DEPTH_LEVELS
        )

        if u_3d is None:
            print(f"  ❌ Failed to combine depth layers, skipping day")
            skipped_days.append(date_dir.name)
            continue

        # Write to binary
        filename = write_3d_binary(u_3d, v_3d, lon_2d, lat_2d,
                                   year, month, day, actual_depths, OUTPUT_DIR)

        # Get bounding box
        lon_min, lon_max = float(lon_2d.min()), float(lon_2d.max())
        lat_min, lat_max = float(lat_2d.min()), float(lat_2d.max())

        processed_days.append({
            'year': year, 'month': month, 'day': day,
            'date_str': f"{year}-{month:02d}-{day:02d}",
            'day_offset': day_offset,
            'file': filename,
            'lat_size': u_3d.shape[1],
            'lon_size': u_3d.shape[2],
            'depth_count': u_3d.shape[0],
            'actual_depths': actual_depths,
            'lon_range': [lon_min, lon_max],
            'lat_range': [lat_min, lat_max]
        })

        print(f"  ✅ Saved: {filename}")

    # Create metadata
    if processed_days:
        valid_days = [d for d in processed_days if 'skipped' not in d]

        if valid_days:
            # Get actual depths from first valid day
            first_day = valid_days[0]
            actual_depths = first_day.get('actual_depths', DEPTH_LEVELS)

            metadata = {
                'description': '3D HYCOM currents at multiple depths',
                'binary_version': BINARY_VERSION,
                'base_date': BASE_DATE.isoformat(),
                'depths': actual_depths,
                'target_depths': DEPTH_LEVELS,
                'depth_count': len(actual_depths),
                'bounding_box': {
                    'north': first_day['lat_range'][1],
                    'south': first_day['lat_range'][0],
                    'east': first_day['lon_range'][1],
                    'west': first_day['lon_range'][0]
                },
                'days': [{
                    'year': d['year'],
                    'month': d['month'],
                    'day': d['day'],
                    'date_str': d['date_str'],
                    'day_offset': d['day_offset'],
                    'file': d['file']
                } for d in valid_days]
            }

            metadata_path = os.path.join(OUTPUT_DIR, "currents_3d_metadata.json")
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            print(f"\n{'=' * 70}")
            print(f"✅ Processed {len(valid_days)} daily 3D files")
            print(f"Skipped {len(skipped_days)} days")
            print(f"Date range: {valid_days[0]['date_str']} to {valid_days[-1]['date_str']}")
            print(f"Depths: {actual_depths}")
            print(f"Grid size: {valid_days[0]['lat_size']}x{valid_days[0]['lon_size']}")
            print(f"Metadata: {metadata_path}")
        else:
            print(f"\n⚠️ No valid days were processed!")

    else:
        print(f"\n❌ No days were processed successfully!")


if __name__ == "__main__":
    main()