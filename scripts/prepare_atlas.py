"""
Grid eddy radii from META3.2 atlas to HYCOM curvilinear grid.
Uses direct nearest-neighbor interpolation (no intermediate regular grid).
"""

import xarray as xr
import numpy as np
import struct
import json
import os
from datetime import datetime
import gc
from scipy.interpolate import NearestNDInterpolator
import warnings
import pandas as pd

# ===== CONFIGURATION =====
TEST_MODE = False  # Set to True for testing
INPUT_FILE = "data/eddy_atlas/eddy_all_pacific_2011_2013.nc"  # Your combined eddy file
HYCOM_DIR = "data/currents_3d_bin"
OUTPUT_DIR = "data/eddy_radii_grid"
DAILY_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "daily")
COORDS_FILE = os.path.join(OUTPUT_DIR, "eddy_coords.bin")

os.makedirs(DAILY_OUTPUT_DIR, exist_ok=True)

warnings.filterwarnings('ignore')


# ===== HYCOM GRID LOADING =====

def load_hycom_grid_from_binary():
    """Load HYCOM grid coordinates directly from first binary file."""
    print("📊 Loading HYCOM grid coordinates from binary...")

    # Find first HYCOM file
    files = sorted([f for f in os.listdir(HYCOM_DIR) if f.endswith('.bin') and 'currents_' in f])

    if not files:
        raise FileNotFoundError(f"No HYCOM binary files found in {HYCOM_DIR}")

    first_file = os.path.join(HYCOM_DIR, files[0])
    print(f"  Using: {files[0]}")

    with open(first_file, 'rb') as f:
        # Read header (version, n_lat, n_lon, n_depth, year, month, day)
        header = struct.unpack('7i', f.read(28))
        version, n_lat, n_lon, n_depth, year, month, day = header

        total_cells = n_lat * n_lon
        print(f"  ✓ Grid: {n_lat}×{n_lon}")

        # Read lon/lat arrays
        lon_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)
        lat_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)

        lon_grid = lon_array.reshape((n_lat, n_lon))
        lat_grid = lat_array.reshape((n_lat, n_lon))

        print(f"  ✓ Longitude: {lon_grid.min():.2f}° to {lon_grid.max():.2f}°")
        print(f"  ✓ Latitude: {lat_grid.min():.2f}° to {lat_grid.max():.2f}°")

        return {
            'lon_grid': lon_grid,
            'lat_grid': lat_grid,
            'n_lat': n_lat,
            'n_lon': n_lon,
            'metadata': {'files': files}
        }


# ===== COORDINATES FILE =====

def save_coordinates_file(lon_grid, lat_grid, output_path):
    """Save coordinates once (float32)."""
    print(f"\n💾 Creating single coordinates file...")

    n_lat, n_lon = lon_grid.shape
    total_cells = n_lat * n_lon

    with open(output_path, 'wb') as f:
        header = struct.pack('3i', 1, n_lat, n_lon)
        f.write(header)
        f.write(lon_grid.astype(np.float32).tobytes())
        f.write(lat_grid.astype(np.float32).tobytes())

    file_size = os.path.getsize(output_path)
    print(f"  ✓ Coordinates saved: {n_lat}×{n_lon} grid")
    print(f"  ✓ File size: {file_size / 1024 / 1024:.1f}MB")

    return {
        'n_lat': n_lat,
        'n_lon': n_lon,
        'total_cells': total_cells,
        'file_size': file_size
    }


# ===== DIRECT INTERPOLATION TO HYCOM GRID =====

def interpolate_eddies_to_hycom(day_eddies, hycom_lon_grid, hycom_lat_grid):
    """
    Interpolate eddy radii directly to HYCOM grid using nearest neighbor.
    """
    # Get eddy positions and radii
    points = np.column_stack([
        day_eddies.longitude.values,
        day_eddies.latitude.values
    ])
    values = day_eddies.effective_radius.values / 1000  # convert to km
    
    if len(points) == 0:
        return None
    
    # Create interpolator
    interp = NearestNDInterpolator(points, values)
    
    # Create HYCOM grid points
    hycom_points = np.column_stack([
        hycom_lon_grid.ravel(),
        hycom_lat_grid.ravel()
    ])
    
    # Interpolate (this is fast even for millions of points)
    radius_hycom_flat = interp(hycom_points)
    radius_hycom = radius_hycom_flat.reshape(hycom_lon_grid.shape)
    
    return radius_hycom.astype(np.float32)


def save_daily_radius_file(radius_hycom, date_obj, coords_info, output_dir):
    """Save daily radius values (float32)."""
    if hasattr(date_obj, 'strftime'):
        date_str = date_obj.strftime('%Y%m%d')
        year, month, day = date_obj.year, date_obj.month, date_obj.day
    else:
        pd_date = pd.Timestamp(date_obj)
        date_str = pd_date.strftime('%Y%m%d')
        year, month, day = pd_date.year, pd_date.month, pd_date.day

    filename = f"eddy_radius_{date_str}.bin"
    filepath = os.path.join(output_dir, filename)

    expected_shape = (coords_info['n_lat'], coords_info['n_lon'])
    if radius_hycom.shape != expected_shape:
        raise ValueError(f"Shape mismatch: {radius_hycom.shape} vs {expected_shape}")

    with open(filepath, 'wb') as f:
        header = struct.pack('4i', 1, year, month, day)
        f.write(header)
        f.write(radius_hycom.tobytes())

    file_size = os.path.getsize(filepath)
    print(f"    📁 {date_str}: {file_size / 1024 / 1024:.2f}MB")
    print(f"    📊 Radius range: {radius_hycom.min():.1f} to {radius_hycom.max():.1f} km")
    print(f"    📊 Radius mean: {radius_hycom.mean():.1f} km")

    return {
        'date': date_str,
        'file': filename,
        'size': int(file_size)
    }


# ===== MAIN =====

def main():
    print("\n" + "=" * 70)
    print("🌪️  GRIDDING EDDY RADII TO HYCOM GRID")
    print("=" * 70)

    # Load HYCOM grid
    hycom_grid = load_hycom_grid_from_binary()

    # Create coordinates file
    coords_info = save_coordinates_file(
        hycom_grid['lon_grid'],
        hycom_grid['lat_grid'],
        COORDS_FILE
    )

    # Load eddy data
    print(f"\n📂 Loading eddy data from {INPUT_FILE}...")
    ds = xr.open_dataset(INPUT_FILE)

    # Get unique days
    unique_days = np.unique(ds.time.values)
    print(f"Found {len(unique_days)} unique days")

    # Initialize metadata
    metadata = {
        'description': 'Gridded eddy radii from META3.2 atlas on HYCOM grid',
        'source': 'META3.2_DT_allsat eddy atlas',
        'interpolation': 'nearest neighbor (no intermediate grid)',
        'grid': {
            'source': f'HYCOM from {HYCOM_DIR}',
            'n_lat': coords_info['n_lat'],
            'n_lon': coords_info['n_lon'],
            'total_cells': coords_info['total_cells'],
            'coordinates_file': 'eddy_coords.bin'
        },
        'units': 'km',
        'time_period': f"{unique_days[0]} to {unique_days[-1]}",
        'dates': [],
        'files': [],
        'processing_date': datetime.now().isoformat()
    }

    # Process each day
    total_days = 0
    total_size = 0

    for day_idx, day in enumerate(unique_days):
        if TEST_MODE and day_idx > 0:
            print(f"\n[TEST MODE] Stopping after first day")
            break

        print(f"\n📅 Day {day_idx + 1}/{len(unique_days)}: {day}")

        # Get eddies for this day
        day_eddies = ds.where(ds.time == day, drop=True)

        if len(day_eddies.obs) == 0:
            print(f"    No eddies found")
            continue

        print(f"    {len(day_eddies.obs)} eddy observations")

        # Interpolate directly to HYCOM grid
        radius_hycom = interpolate_eddies_to_hycom(
            day_eddies,
            hycom_grid['lon_grid'],
            hycom_grid['lat_grid']
        )

        if radius_hycom is None:
            print(f"    Interpolation failed")
            continue

        # Save daily file
        file_info = save_daily_radius_file(
            radius_hycom, day, coords_info, DAILY_OUTPUT_DIR
        )

        metadata['dates'].append(file_info['date'])
        metadata['files'].append(file_info)
        total_days += 1
        total_size += file_info['size']

        # Clean up
        del day_eddies, radius_hycom
        if day_idx % 10 == 0:
            gc.collect()

    # Save metadata
    metadata['total_days'] = total_days
    metadata['total_size_gb'] = total_size / (1024 ** 3)

    metadata_path = os.path.join(OUTPUT_DIR, 'eddy_radii_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print("\n" + "=" * 70)
    print(f"🎉 COMPLETE! Processed {total_days} days")
    print(f"📊 Total size: {metadata['total_size_gb']:.1f}GB")
    print(f"📁 Output in: {OUTPUT_DIR}")
    print("=" * 70)


if __name__ == "__main__":
    main()