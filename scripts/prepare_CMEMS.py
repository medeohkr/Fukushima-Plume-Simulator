"""
Extract pure EKE from CMEMS ugosa/vgosa.
NO physics, NO K calculation — just EKE = 0.5*(ugosa² + vgosa²)
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
TEST_MODE = False
INPUT_DIR = "data/cmems_EKE_data/"
HYCOM_METADATA_PATH = "data/currents_3d_bin/currents_3d_metadata.json"
OUTPUT_DIR = "data/EKE_bin_pure/"
DAILY_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "daily")
COORDS_FILE = os.path.join(OUTPUT_DIR, "eke_coords.bin")
os.makedirs(DAILY_OUTPUT_DIR, exist_ok=True)

warnings.filterwarnings('ignore')


# ===== HYCOM GRID LOADING =====

def load_hycom_grid():
    """Load HYCOM grid coordinates from first month's data."""
    print("📊 Loading HYCOM grid coordinates...")

    try:
        with open(HYCOM_METADATA_PATH, 'r') as f:
            metadata = json.load(f)

        first_month = metadata['months'][0]
        first_file = os.path.join(os.path.dirname(HYCOM_METADATA_PATH), first_month['file'])

        with open(first_file, 'rb') as f:
            header = struct.unpack('5i', f.read(20))
            version, n_lat, n_lon, year, month = header

            total_cells = n_lat * n_lon

            f.seek(20)
            lon_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)
            lat_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)

            lon_grid = lon_array.reshape((n_lat, n_lon))
            lat_grid = lat_array.reshape((n_lat, n_lon))

            print(f"  ✓ HYCOM grid: {n_lat}×{n_lon}")
            print(f"  ✓ Longitude: {lon_grid.min():.2f}° to {lon_grid.max():.2f}°")
            print(f"  ✓ Latitude: {lat_grid.min():.2f}° to {lat_grid.max():.2f}°")

            return {
                'lon_grid': lon_grid,
                'lat_grid': lat_grid,
                'n_lat': n_lat,
                'n_lon': n_lon,
                'metadata': metadata
            }

    except Exception as e:
        print(f"❌ Failed to load HYCOM grid: {e}")
        # Create fallback grid
        print("  Creating fallback 0.04° grid...")
        lon = np.linspace(100.0, 260.0, 1921, dtype=np.float32)
        lat = np.linspace(0.0, 60.0, 721, dtype=np.float32)
        lon_grid, lat_grid = np.meshgrid(lon, lat)

        return {
            'lon_grid': lon_grid,
            'lat_grid': lat_grid,
            'n_lat': 721,
            'n_lon': 1921,
            'metadata': {'months': []}
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


# ===== PURE EKE EXTRACTION =====

def calculate_pure_eke(ugosa, vgosa):
    """Calculate pure EKE without any physics."""
    eke = 0.5 * (np.square(ugosa) + np.square(vgosa))
    
    # Replace NaN with 0
    eke = np.nan_to_num(eke, nan=0.0)
    
    # Diagnostic
    valid_eke = eke[eke > 0]
    if len(valid_eke) > 0:
        print(f"    EKE stats - min={valid_eke.min():.6f}, mean={valid_eke.mean():.6f}, max={valid_eke.max():.6f} m²/s²")
    
    return eke.astype(np.float32)


def interpolate_to_hycom_grid(eke_data, eke_lon, eke_lat, hycom_lon_grid, hycom_lat_grid):
    """Interpolate EKE from regular grid to HYCOM grid."""
    print(f"    Interpolating {eke_data.shape} → {hycom_lon_grid.shape}...")

    hycom_points = np.column_stack([
        hycom_lon_grid.ravel(),
        hycom_lat_grid.ravel()
    ])

    interpolator = RegularGridInterpolator(
        (eke_lat, eke_lon),
        eke_data,
        method='linear',
        bounds_error=False,
        fill_value=0.0
    )

    eke_hycom_flat = interpolator(hycom_points[:, ::-1])
    eke_hycom = eke_hycom_flat.reshape(hycom_lon_grid.shape)

    return eke_hycom.astype(np.float32)


def save_daily_eke_file(eke_data, date_obj, coords_info, output_dir):
    """Save daily EKE as float16."""
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
    if eke_data.shape != expected_shape:
        raise ValueError(f"Shape mismatch: {eke_data.shape} vs {expected_shape}")

    # Convert to float16 for storage
    eke_float16 = eke_data.astype(np.float16)

    with open(filepath, 'wb') as f:
        header = struct.pack('4i', 1, year, month, day)
        f.write(header)
        f.write(eke_float16.tobytes())

    file_size = os.path.getsize(filepath)
    print(f"    📁 {date_str}: {file_size / 1024 / 1024:.2f}MB")

    return {
        'date': date_str,
        'file': filename,
        'size': int(file_size)
    }


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

        for day_idx in range(total_days):
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

                # Calculate pure EKE
                eke = calculate_pure_eke(ugosa_day, vgosa_day)

                # Interpolate to HYCOM grid
                eke_hycom = interpolate_to_hycom_grid(
                    eke, eke_lon, eke_lat,
                    hycom_grid['lon_grid'], hycom_grid['lat_grid']
                )

                # Save
                file_info = save_daily_eke_file(
                    eke_hycom, date_for_file, coords_info, DAILY_OUTPUT_DIR
                )

                all_metadata['dates'].append(file_info['date'])
                all_metadata['files'].append(file_info)

                file_stats['days_processed'] += 1
                file_stats['total_size'] += file_info['size']

                # Clean up
                del ugosa_day, vgosa_day, eke, eke_hycom
                if day_idx % 20 == 0:
                    gc.collect()

            except Exception as e:
                print(f"    ❌ Error day {day_idx}: {e}")
                file_stats['errors'] += 1
                continue

        ds.close()
        print(f"  ✅ Processed {file_stats['days_processed']} days")

    except Exception as e:
        print(f"❌ Failed to process file: {e}")

    return all_metadata, file_stats


def main():
    print("\n" + "=" * 70)
    print("📊 PURE EKE EXTRACTION - NO PHYSICS")
    print("=" * 70)

    # Load HYCOM grid
    hycom_grid = load_hycom_grid()

    # Create coordinates file
    coords_info = save_coordinates_file(
        hycom_grid['lon_grid'],
        hycom_grid['lat_grid'],
        COORDS_FILE
    )

    # Initialize metadata
    metadata = {
        'description': 'Pure EKE from CMEMS ugosa/vgosa on HYCOM grid',
        'formula': 'EKE = 0.5*(ugosa² + vgosa²)',
        'grid': {
            'n_lat': coords_info['n_lat'],
            'n_lon': coords_info['n_lon'],
            'total_cells': coords_info['total_cells'],
            'coordinates_file': 'eke_coords.bin'
        },
        'units': 'm²/s²',
        'time_period': '2011-01-01 to 2013-12-31',
        'dates': [],
        'files': [],
        'processing_date': datetime.now().isoformat(),
        'binary_format': {
            'version': 1,
            'daily_header': '4 integers: version, year, month, day',
            'data': 'float16 EKE values'
        }
    }

    # Get all CMEMS files
    cmems_files = []
    for filename in sorted(os.listdir(INPUT_DIR)):
        if filename.endswith('.nc'):
            cmems_files.append(os.path.join(INPUT_DIR, filename))

    if not cmems_files:
        print(f"❌ No .nc files found in {INPUT_DIR}")
        return

    print(f"\n📚 Found {len(cmems_files)} CMEMS files")

    # Process each file
    total_stats = {'days_processed': 0, 'errors': 0, 'total_size': 0}

    for file_idx, filepath in enumerate(cmems_files, 1):
        print(f"\n{'=' * 60}")
        print(f"FILE {file_idx}/{len(cmems_files)}")

        metadata, file_stats = process_single_eke_file(
            filepath, hycom_grid, coords_info, metadata
        )

        total_stats['days_processed'] += file_stats['days_processed']
        total_stats['errors'] += file_stats['errors']
        total_stats['total_size'] += file_stats['total_size']

        if TEST_MODE:
            print(f"\n[TEST MODE] Stopping after first file")
            break

    # Finalize
    metadata['total_days'] = len(metadata['dates'])
    metadata['total_size_gb'] = total_stats['total_size'] / (1024 ** 3)

    metadata_path = os.path.join(OUTPUT_DIR, 'eke_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print("\n" + "=" * 70)
    print("🎉 PROCESSING COMPLETE!")
    print("=" * 70)
    print(f"\n📊 RESULTS:")
    print(f"  Days processed: {total_stats['days_processed']}")
    print(f"  Total size: {metadata['total_size_gb']:.1f}GB")
    print(f"  Average per day: {total_stats['total_size']/total_stats['days_processed']/1024/1024:.1f}MB")


if __name__ == "__main__":
    main()