# process_eke_ultra_optimized.py
"""
EKE processing with PHYSICS-BASED scaling.
Interpolating to HYCOM grid: 1793 × 2324
Using float32 for simplicity
"""

import xarray as xr
import numpy as np
import pandas as pd
import struct
import json
import os
from datetime import datetime
import gc
from scipy.interpolate import RegularGridInterpolator
import warnings

# ===== CONFIGURATION =====
TEST_MODE = False  # Set to True for testing, False for full processing
INPUT_DIR = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/data/cmems_EKE_data"
OUTPUT_DIR = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/data/EKE_bin"
DAILY_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "daily")
COORDS_FILE = os.path.join(OUTPUT_DIR, "eke_coords.bin")
os.makedirs(DAILY_OUTPUT_DIR, exist_ok=True)

# HYCOM grid dimensions -直接从你的二进制文件读取
HYCOM_N_LAT = 1793
HYCOM_N_LON = 2324

# Physics constants
C = 0.1  # Empirical constant
T_L_DAYS = 7  # Lagrangian timescale
T_L_SECONDS = T_L_DAYS * 86400
ALPHA = 0.1  # Scale factor for anomaly EKE

warnings.filterwarnings('ignore')


# ===== HYCOM GRID CREATION =====

def create_hycom_grid():
    """Create a simple lat/lon grid for HYCOM dimensions."""
    print("📊 Creating HYCOM grid coordinates...")

    # Create simple lat/lon arrays based on typical North Pacific range
    lon = np.linspace(120, 185, HYCOM_N_LON, dtype=np.float32)
    lat = np.linspace(15, 65, HYCOM_N_LAT, dtype=np.float32)

    lon_grid, lat_grid = np.meshgrid(lon, lat)

    print(f"  ✓ HYCOM grid: {HYCOM_N_LAT}×{HYCOM_N_LON}")
    print(f"  ✓ Longitude: {lon_grid.min():.2f}° to {lon_grid.max():.2f}°")
    print(f"  ✓ Latitude: {lat_grid.min():.2f}° to {lat_grid.max():.2f}°")

    return {
        'lon_grid': lon_grid,
        'lat_grid': lat_grid,
        'n_lat': HYCOM_N_LAT,
        'n_lon': HYCOM_N_LON
    }


# ===== BINARY FORMAT =====

def save_coordinates_file(lon_grid, lat_grid, output_path):
    """Save coordinates once (float32)."""
    print(f"\n💾 Creating single coordinates file...")

    n_lat, n_lon = lon_grid.shape
    total_cells = n_lat * n_lon

    with open(output_path, 'wb') as f:
        header = struct.pack('3i', 1, n_lat, n_lon)  # version 1
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


def save_daily_k_file(K_data_float32, date_obj, coords_info, output_dir):
    """Save daily K values (float32)."""
    if hasattr(date_obj, 'strftime'):
        date_str = date_obj.strftime('%Y%m%d')
        year, month, day = date_obj.year, date_obj.month, date_obj.day
    else:
        pd_date = pd.Timestamp(date_obj)
        date_str = pd_date.strftime('%Y%m%d')
        year, month, day = pd_date.year, pd_date.month, pd_date.day

    filename = f"eke_{date_str}.bin"
    filepath = os.path.join(output_dir, filename)

    expected_shape = (coords_info['n_lat'], coords_info['n_lon'])
    if K_data_float32.shape != expected_shape:
        raise ValueError(f"Shape mismatch: {K_data_float32.shape} vs {expected_shape}")

    with open(filepath, 'wb') as f:
        header = struct.pack('4i', 1, year, month, day)  # version 1, date
        f.write(header)
        f.write(K_data_float32.tobytes())

    file_size = os.path.getsize(filepath)
    print(f"    📁 {date_str}: {file_size / 1024 / 1024:.2f}MB (float32)")

    return {
        'date': date_str,
        'file': filename,
        'size': int(file_size)
    }


# ===== EKE PROCESSING =====

def calculate_diffusivity(ugosa, vgosa):
    """
    Calculate diffusivity K from geostrophic anomaly velocities.
    """
    # Calculate EKE from geostrophic anomalies
    eke = 0.5 * (np.square(ugosa) + np.square(vgosa))

    # Scale anomaly-EKE to effective diffusivity
    eke_effective = eke * ALPHA

    # Calculate diffusivity using physics formula
    K = C * eke_effective * T_L_SECONDS

    # Apply physics-based maximum
    MAX_PHYSICAL_K = 3000.0
    K = np.minimum(K, MAX_PHYSICAL_K)

    # Replace NaN with 0
    K = np.nan_to_num(K, nan=0.0)

    return K.astype(np.float32)


def interpolate_to_hycom_grid(K_eke, eke_lon, eke_lat, hycom_grid):
    """Interpolate diffusivity from EKE grid to HYCOM grid."""
    print(f"    Interpolating {K_eke.shape} → {hycom_grid['n_lat']}×{hycom_grid['n_lon']}...")

    # Create interpolation points for HYCOM grid
    hycom_points = np.column_stack([
        hycom_grid['lon_grid'].ravel(),
        hycom_grid['lat_grid'].ravel()
    ])

    # Create interpolator
    interpolator = RegularGridInterpolator(
        (eke_lat, eke_lon),
        K_eke,
        method='linear',
        bounds_error=False,
        fill_value=0.0
    )

    # Interpolate
    K_hycom_flat = interpolator(hycom_points[:, ::-1])  # Reverse to (lat, lon)
    K_hycom = K_hycom_flat.reshape(hycom_grid['lon_grid'].shape)

    return K_hycom.astype(np.float32)


def process_single_eke_file(filepath, hycom_grid, coords_info, all_metadata):
    """Process one EKE file."""
    print(f"\n📂 Processing: {os.path.basename(filepath)}")

    file_stats = {'days_processed': 0, 'errors': 0, 'total_size': 0}

    try:
        ds = xr.open_dataset(filepath, chunks={'time': 10})
        eke_lon = ds.longitude.values.astype(np.float32)
        eke_lat = ds.latitude.values.astype(np.float32)
        time_values = ds.time.values
        total_days = len(time_values)

        print(f"  Found {total_days} days in file")
        print(f"  Using ALPHA = {ALPHA}")

        for day_idx in range(total_days):
            # Test mode: process only first day
            if TEST_MODE and day_idx > 0:
                print(f"  [TEST MODE] Skipping remaining days...")
                break

            try:
                # Extract data
                ugosa_day = ds['ugosa'].isel(time=day_idx).values
                vgosa_day = ds['vgosa'].isel(time=day_idx).values
                date_obj = ds.time.isel(time=day_idx).values

                if isinstance(date_obj, np.datetime64):
                    pd_date = pd.Timestamp(date_obj)
                    date_for_file = pd_date.to_pydatetime()
                    date_str = pd_date.strftime('%Y-%m-%d')
                else:
                    date_for_file = date_obj
                    date_str = date_obj.strftime('%Y-%m-%d')

                if (day_idx + 1) % 10 == 0 or (day_idx + 1) == total_days:
                    print(f"    Day {day_idx + 1:3d}/{total_days}: {date_str}")

                # Calculate diffusivity
                K_eke = calculate_diffusivity(ugosa_day, vgosa_day)

                # Interpolate to HYCOM grid
                K_hycom = interpolate_to_hycom_grid(
                    K_eke, eke_lon, eke_lat, hycom_grid
                )

                # Save in binary format
                file_info = save_daily_k_file(
                    K_hycom, date_for_file, coords_info, DAILY_OUTPUT_DIR
                )

                # Add to metadata
                all_metadata['dates'].append(file_info['date'])
                all_metadata['files'].append(file_info)

                # Update stats
                file_stats['days_processed'] += 1
                file_stats['total_size'] += file_info['size']

                # Clean up
                del ugosa_day, vgosa_day, K_eke, K_hycom
                if day_idx % 20 == 0:
                    gc.collect()

            except Exception as e:
                print(f"    ❌ Error day {day_idx}: {e}")
                file_stats['errors'] += 1
                continue

        ds.close()
        print(f"  ✅ Processed {file_stats['days_processed']} days")
        print(f"  📊 Total size: {file_stats['total_size'] / 1024 / 1024:.1f}MB")

    except Exception as e:
        print(f"❌ Failed to process file: {e}")

    return all_metadata, file_stats


# ===== MAIN =====

def main():
    print("\n" + "=" * 70)
    print("EKE PROCESSING FOR HYCOM GRID (1793×2324)")
    print("=" * 70)
    print(f"🔧 Configuration:")
    print(f"   ALPHA = {ALPHA}")
    print(f"   C = {C}")
    print(f"   T_L = {T_L_DAYS} days")
    print(f"   Output format: float32")
    print("=" * 70)

    # Create HYCOM grid
    hycom_grid = create_hycom_grid()

    # Create single coordinates file
    coords_info = save_coordinates_file(
        hycom_grid['lon_grid'],
        hycom_grid['lat_grid'],
        COORDS_FILE
    )

    # Initialize metadata
    metadata = {
        'description': 'Daily diffusivity for HYCOM grid (1793×2324)',
        'physics': {
            'formula': 'K = C * (ALPHA * EKE) * T_L where EKE = 0.5*(ugosa² + vgosa²)',
            'constants': {
                'C': C,
                'ALPHA': ALPHA,
                'T_L_days': T_L_DAYS,
                'T_L_seconds': T_L_SECONDS
            },
            'units': 'm²/s'
        },
        'grid': {
            'source': 'HYCOM',
            'n_lat': HYCOM_N_LAT,
            'n_lon': HYCOM_N_LON,
            'total_cells': HYCOM_N_LAT * HYCOM_N_LON,
            'coordinates_file': 'eke_coords.bin'
        },
        'dates': [],
        'files': [],
        'processing_date': datetime.now().isoformat(),
        'binary_format': {
            'version': 1,
            'coordinates_header': '3 integers: version, n_lat, n_lon',
            'daily_header': '4 integers: version, year, month, day',
            'data': 'float32 K values'
        }
    }

    # Get all EKE files
    eke_files = []
    for filename in sorted(os.listdir(INPUT_DIR)):
        if filename.endswith('.nc'):
            eke_files.append(os.path.join(INPUT_DIR, filename))

    if not eke_files:
        print(f"❌ No .nc files found in {INPUT_DIR}")
        return

    print(f"\n📚 Found {len(eke_files)} EKE data files")

    # Process each file
    total_stats = {'days_processed': 0, 'errors': 0, 'total_size': 0}

    for file_idx, filepath in enumerate(eke_files, 1):
        print(f"\n{'=' * 60}")
        print(f"FILE {file_idx}/{len(eke_files)}")

        metadata, file_stats = process_single_eke_file(
            filepath, hycom_grid, coords_info, metadata
        )

        total_stats['days_processed'] += file_stats['days_processed']
        total_stats['errors'] += file_stats['errors']
        total_stats['total_size'] += file_stats['total_size']

        # Stop after first file in test mode
        if TEST_MODE:
            print(f"\n[TEST MODE] Stopping after first file")
            break

    # Finalize metadata
    metadata['total_days'] = len(metadata['dates'])
    metadata['storage_summary'] = {
        'coordinates_size_mb': coords_info['file_size'] / (1024 ** 2),
        'total_daily_size_mb': total_stats['total_size'] / (1024 ** 2),
        'average_daily_size_mb': (total_stats['total_size'] / total_stats['days_processed']) / (1024 ** 2) if
        total_stats['days_processed'] > 0 else 0,
        'days_processed': total_stats['days_processed']
    }

    # Save metadata
    metadata_path = os.path.join(OUTPUT_DIR, 'eke_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    # Print results
    print("\n" + "=" * 70)
    print("🎉 PROCESSING COMPLETE!")
    print("=" * 70)
    print(f"\n📊 RESULTS SUMMARY:")
    print(f"  Grid: {HYCOM_N_LAT}×{HYCOM_N_LON}")
    print(f"  Days processed: {total_stats['days_processed']}")
    print(f"  Daily file size: {metadata['storage_summary']['average_daily_size_mb']:.1f}MB")
    print(f"  Total size: {metadata['storage_summary']['total_daily_size_mb']:.1f}MB")

    print(f"\n📁 Output:")
    print(f"  {COORDS_FILE}")
    print(f"  {DAILY_OUTPUT_DIR}/ (daily files)")
    print(f"  {metadata_path}")

    if TEST_MODE:
        print(f"\n⚠️  TEST MODE: Only processed first file")


if __name__ == "__main__":
    main()