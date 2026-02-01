# prepare_HYCOM_FIXED.py
"""
FIXED HYCOM Converter - Saves tripole grid coordinates WITH velocity data
Solves the "land everywhere" problem by including correct coordinates.
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
DATA_DIR = "web/data/hycom_data"  # Input directory with .nc4 files
OUTPUT_DIR = "web/data/currents_bin"  # Output directory for binary files
GRID_TYPE = "tripole"  # GLBa0.08 uses tripole grid
BINARY_VERSION = 2  # Version 2 = with coordinates


def get_month_year_from_index(file_index):
    """
    Convert file index to actual month/year.
    March 2011 = base file (index -1)
    """
    base_date = datetime(2011, 3, 1)

    if file_index == -1:  # Base file (expt_90_2011.nc4)
        offset = 0
    else:  # Numbered files (expt_90_2011(1).nc4, etc.)
        offset = file_index + 1

    # Approximate month length
    target_date = base_date + timedelta(days=offset * 30.44)

    year = target_date.year
    month = target_date.month
    month_name = target_date.strftime("%B")

    return year, month, month_name


def find_and_sort_hycom_files(data_dir):
    """Find and sort all HYCOM .nc4 files in directory."""
    files = []

    # Pattern for base file
    base_pattern = re.compile(r'^expt_90_2011\.nc4$')

    # Pattern for numbered files
    numbered_pattern = re.compile(r'^expt_90_2011\((\d+)\)\.nc4$')

    for filepath in Path(data_dir).glob("*.nc4"):
        filename = filepath.name

        if base_pattern.match(filename):
            files.append((-1, filepath))  # -1 indicates base file
        else:
            match = numbered_pattern.match(filename)
            if match:
                index = int(match.group(1))
                files.append((index, filepath))

    # Sort by index: base file first (-1), then 0, 1, 2, ...
    files.sort(key=lambda x: x[0])

    return files


def extract_hycom_data(dataset):
    """
    Extract surface currents AND tripole grid coordinates from dataset.

    Returns:
        u_surface, v_surface, lon_2d, lat_2d, land_mask
    """
    print("  Extracting HYCOM tripole grid data...")

    # Get tripole grid coordinates (2D arrays)
    lon_2d = dataset['Longitude'].values  # Shape: (1261, 1626)
    lat_2d = dataset['Latitude'].values  # Shape: (1261, 1626)

    # Get velocity data
    u_data = dataset['u']
    v_data = dataset['v']

    print(f"  Grid shape: {lon_2d.shape}")
    print(f"  Lon range: [{lon_2d.min():.2f}, {lon_2d.max():.2f}]")
    print(f"  Lat range: [{lat_2d.min():.2f}, {lat_2d.max():.2f}]")

    # Extract surface layer (depth=0) and average over time
    u_values = u_data.values  # Shape: (time, 1, 1261, 1626)
    v_values = v_data.values

    if u_values.ndim == 4:
        # Average over time, take surface layer
        u_surface = np.nanmean(u_values[:, 0, :, :], axis=0)
        v_surface = np.nanmean(v_values[:, 0, :, :], axis=0)
    else:
        raise ValueError(f"Unexpected data shape: {u_values.shape}")

    # Create land mask (NaN values)
    land_mask = np.isnan(u_surface)

    print(f"  U shape: {u_surface.shape}")
    print(f"  Ocean cells: {np.sum(~land_mask):,}/{u_surface.size:,} "
          f"({np.sum(~land_mask) / u_surface.size * 100:.1f}%)")
    print(f"  U range: [{np.nanmin(u_surface):.6f}, {np.nanmax(u_surface):.6f}] m/s")

    return u_surface, v_surface, lon_2d, lat_2d, land_mask


def write_hycom_binary(u_data, v_data, lon_data, lat_data, year, month, output_dir):
    """
    Write HYCOM data with coordinates to binary format.

    Binary format (Version 2):
    - Header: [version, n_lat, n_lon, year, month] (5 integers)
    - Coordinates: lon_2d, lat_2d (float32, n_lat × n_lon each)
    - Data: u_surface, v_surface (float32, n_lat × n_lon each)
    """
    os.makedirs(output_dir, exist_ok=True)

    n_lat, n_lon = u_data.shape

    # Combined file with coordinates
    filename = f"currents_{year}_{month:02d}.bin"
    filepath = os.path.join(output_dir, filename)

    print(f"  Writing: {filename} ({n_lat}x{n_lon})")

    with open(filepath, 'wb') as f:
        # Header: version, dimensions, date
        # version=2 indicates "with coordinates"
        header = struct.pack('5i', BINARY_VERSION, n_lat, n_lon, year, month)
        f.write(header)

        # Write tripole grid coordinates (CRITICAL!)
        f.write(np.ascontiguousarray(lon_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(lat_data, dtype=np.float32).tobytes())

        # Write velocity data (with NaN preserved as land mask)
        f.write(np.ascontiguousarray(u_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(v_data, dtype=np.float32).tobytes())

    # Also create separate U and V files for web streaming (optional)
    u_filename = f"currents_u_{year}_{month:02d}.bin"
    v_filename = f"currents_v_{year}_{month:02d}.bin"

    # U file (with coordinates)
    with open(os.path.join(output_dir, u_filename), 'wb') as f:
        header = struct.pack('4i', BINARY_VERSION, n_lat, n_lon, 1)
        f.write(header)
        f.write(np.ascontiguousarray(lon_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(lat_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(u_data, dtype=np.float32).tobytes())

    # V file (with coordinates)
    with open(os.path.join(output_dir, v_filename), 'wb') as f:
        header = struct.pack('4i', BINARY_VERSION, n_lat, n_lon, 1)
        f.write(header)
        f.write(np.ascontiguousarray(lon_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(lat_data, dtype=np.float32).tobytes())
        f.write(np.ascontiguousarray(v_data, dtype=np.float32).tobytes())

    return filename, u_filename, v_filename


def verify_output(filepath, lon_test=141.5, lat_test=39.6):
    """
    Verify the binary file was written correctly.
    """
    print(f"  Verifying: {filepath}")

    with open(filepath, 'rb') as f:
        # Read header
        version, n_lat, n_lon, year, month = struct.unpack('5i', f.read(20))

        # Read coordinates
        lon_bytes = f.read(n_lat * n_lon * 4)  # 4 bytes per float32
        lat_bytes = f.read(n_lat * n_lon * 4)

        # Read data
        u_bytes = f.read(n_lat * n_lon * 4)
        v_bytes = f.read(n_lat * n_lon * 4)

    # Convert to numpy arrays
    lon_2d = np.frombuffer(lon_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    lat_2d = np.frombuffer(lat_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    u_data = np.frombuffer(u_bytes, dtype=np.float32).reshape(n_lat, n_lon)

    print(f"    Version: {version}")
    print(f"    Dimensions: {n_lat}x{n_lon}")
    print(f"    Date: {year}-{month:02d}")
    print(f"    Lon range: [{lon_2d.min():.2f}, {lon_2d.max():.2f}]")
    print(f"    Lat range: [{lat_2d.min():.2f}, {lat_2d.max():.2f}]")
    print(f"    U range: [{np.nanmin(u_data):.6f}, {np.nanmax(u_data):.6f}]")

    # Test lookup
    if lon_2d.min() <= lon_test <= lon_2d.max() and \
            lat_2d.min() <= lat_test <= lat_2d.max():
        dist = (lon_2d - lon_test) ** 2 + (lat_2d - lat_test) ** 2
        idx = np.unravel_index(np.argmin(dist), dist.shape)
        print(f"    Test point ({lon_test}, {lat_test}):")
        print(f"      Grid cell: {idx}")
        print(f"      Coords: ({lon_2d[idx]:.2f}, {lat_2d[idx]:.2f})")
        print(f"      U: {u_data[idx]:.6f} m/s")

    return True


def create_metadata(processed_files, output_dir):
    """Create metadata JSON for web app."""
    metadata = {
        'description': 'HYCOM surface currents with tripole grid coordinates',
        'dataset': 'GLBa0.08 (expt_90)',
        'region': '0-72.54°N, 109.03-251.33°E',
        'grid_type': 'tripole (curvilinear)',
        'resolution': '0.08°',
        'binary_version': BINARY_VERSION,
        'binary_format': {
            'header': 'version, n_lat, n_lon, year, month (5 integers)',
            'data_order': 'lon_2d, lat_2d, u_surface, v_surface (all float32)',
            'note': 'NaN values represent land mask'
        },
        'variables': {
            'lon': 'longitude (degrees_east)',
            'lat': 'latitude (degrees_north)',
            'u': 'eastward velocity (m/s)',
            'v': 'northward velocity (m/s)'
        },
        'months': []
    }

    for info in processed_files:
        metadata['months'].append({
            'year': info['year'],
            'month': info['month'],
            'month_name': info['month_name'],
            'file': info['file'],
            'u_file': info['u_file'],
            'v_file': info['v_file'],
            'grid_shape': [info['lat_size'], info['lon_size']],
            'lon_range': info['lon_range'],
            'lat_range': info['lat_range']
        })

    metadata_path = os.path.join(output_dir, "currents_metadata.json")
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"\n✅ Metadata saved to: {metadata_path}")
    return metadata_path


def main():
    """Main conversion function."""
    print("=" * 70)
    print("HYCOM TRIPOLE GRID CONVERTER (FIXED)")
    print("=" * 70)
    print(f"Input directory: {DATA_DIR}")
    print(f"Output directory: {OUTPUT_DIR}")
    print(f"Grid type: {GRID_TYPE}")
    print(f"Binary version: {BINARY_VERSION} (with coordinates)")
    print("=" * 70)

    # Find and sort files
    sorted_files = find_and_sort_hycom_files(DATA_DIR)

    if not sorted_files:
        print(f"❌ No .nc4 files found in {DATA_DIR}")
        sys.exit(1)

    print(f"Found {len(sorted_files)} HYCOM files")

    processed_files = []

    for file_index, filepath in sorted_files:
        # Get actual date for this file
        year, month, month_name = get_month_year_from_index(file_index)

        print(f"\n{'=' * 50}")
        print(f"Processing: {filepath.name}")
        print(f"Date: {month_name} {year} (Index: {file_index})")

        try:
            # Open the NetCDF file
            ds = xr.open_dataset(filepath)

            # Extract data WITH coordinates
            u_surface, v_surface, lon_2d, lat_2d, land_mask = extract_hycom_data(ds)

            # Write to binary format (WITH coordinates)
            combined_file, u_file, v_file = write_hycom_binary(
                u_surface, v_surface, lon_2d, lat_2d,
                year, month, OUTPUT_DIR
            )

            # Store metadata
            processed_files.append({
                'file_index': file_index,
                'year': year,
                'month': month,
                'month_name': month_name,
                'file': combined_file,
                'u_file': u_file,
                'v_file': v_file,
                'lat_size': u_surface.shape[0],
                'lon_size': u_surface.shape[1],
                'lon_range': [float(lon_2d.min()), float(lon_2d.max())],
                'lat_range': [float(lat_2d.min()), float(lat_2d.max())],
                'original_file': filepath.name
            })

            # Verify the output
            output_path = os.path.join(OUTPUT_DIR, combined_file)
            verify_output(output_path)

            ds.close()

            print(f"  ✅ Successfully processed {month_name} {year}")

        except Exception as e:
            print(f"❌ Error processing {filepath.name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    # Create metadata file
    if processed_files:
        metadata_path = create_metadata(processed_files, OUTPUT_DIR)

        print(f"\n{'=' * 70}")
        print("✅ CONVERSION COMPLETE!")
        print(f"Processed {len(processed_files)} months")
        print(f"Output directory: {OUTPUT_DIR}")
        print(f"Metadata: {metadata_path}")

        # Summary
        print(f"\n📊 Summary of converted files:")
        for info in processed_files[:5]:  # Show first 5
            print(f"  {info['month_name']} {info['year']}: {info['u_file']}")
        if len(processed_files) > 5:
            print(f"  ... and {len(processed_files) - 5} more")

        # Total size
        total_size = 0
        for info in processed_files:
            file_path = os.path.join(OUTPUT_DIR, info['file'])
            if os.path.exists(file_path):
                total_size += os.path.getsize(file_path)

        print(f"\n💾 Total binary data: {total_size / (1024 ** 3):.2f} GB")

        # Instructions for web app
        print(f"\n🚀 NEXT STEPS for your web app:")
        print(f"1. Update hycomLoader.js to read binary version {BINARY_VERSION}")
        print(f"2. Use the actual lon_2d/lat_2d arrays for position lookup")
        print(f"3. Do NOT calculate positions from regular grid!")

    else:
        print("❌ No files were successfully processed")
        sys.exit(1)


if __name__ == "__main__":
    main()