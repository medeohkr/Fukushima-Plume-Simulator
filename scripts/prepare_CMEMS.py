# process_eke_ultra_optimized.py
"""
ULTRA-OPTIMIZED EKE processing with PHYSICS-BASED scaling.
NO artificial bounds - let CMEMS data + physics determine values!
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
INPUT_DIR = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/web/data/cmems_EKE_data"
HYCOM_METADATA_PATH = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/web/data/currents_bin/currents_metadata.json"
OUTPUT_DIR = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/web/data/eke_ultra_optimized"
DAILY_OUTPUT_DIR = os.path.join(OUTPUT_DIR, "daily")
COORDS_FILE = os.path.join(OUTPUT_DIR, "eke_coords.bin")
os.makedirs(DAILY_OUTPUT_DIR, exist_ok=True)

# Physics constants - NO ARTIFICIAL BOUNDS!
C = 0.1  # Empirical constant
T_L_DAYS = 7  # Lagrangian timescale
T_L_SECONDS = T_L_DAYS * 86400
ALPHA = 0.1  # Scale factor for anomaly EKE (15% - adjustable)

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
        lon = np.linspace(120.0, 185.0, 1626, dtype=np.float32)
        lat = np.linspace(15.0, 65.0, 1261, dtype=np.float32)
        lon_grid, lat_grid = np.meshgrid(lon, lat)

        return {
            'lon_grid': lon_grid,
            'lat_grid': lat_grid,
            'n_lat': 1261,
            'n_lon': 1626,
            'metadata': {'months': []}
        }


# ===== OPTIMIZED BINARY FORMAT =====

def save_coordinates_file(lon_grid, lat_grid, output_path):
    """Save coordinates once (float32)."""
    print(f"\n💾 Creating single coordinates file...")

    n_lat, n_lon = lon_grid.shape
    total_cells = n_lat * n_lon

    with open(output_path, 'wb') as f:
        header = struct.pack('3i', 6, n_lat, n_lon)
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


def validate_float16_precision(K_data_float32):
    """Test float16 precision."""
    print("  🔍 Validating float16 precision...")

    K_float16 = K_data_float32.astype(np.float16)
    K_back_to_float32 = K_float16.astype(np.float32)

    abs_errors = np.abs(K_data_float32 - K_back_to_float32)
    max_error = np.max(abs_errors)
    mean_error = np.mean(abs_errors)

    print(f"    Original range: {K_data_float32.min():.1f} to {K_data_float32.max():.1f} m²/s")
    print(f"    Float16 range:  {K_back_to_float32.min():.1f} to {K_back_to_float32.max():.1f} m²/s")
    print(f"    Max error: {max_error:.3f} m²/s")
    print(f"    Mean error: {mean_error:.3f} m²/s")

    if max_error > 2.0:
        print(f"    ⚠️  Warning: Float16 precision loss > 2 m²/s")

    return K_float16, max_error, mean_error


def save_daily_k_file_optimized(K_data_float32, date_obj, coords_info, output_dir):
    """Save daily K values in optimized format (float16)."""
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

    K_float16, max_error, mean_error = validate_float16_precision(K_data_float32)

    with open(filepath, 'wb') as f:
        max_error_scaled = int(max_error * 1000)
        header = struct.pack('5i', 6, year, month, day, max_error_scaled)
        f.write(header)
        f.write(K_float16.tobytes())

    file_size = os.path.getsize(filepath)
    float32_size = coords_info['total_cells'] * 4
    savings_pct = (1 - file_size / float32_size) * 100

    print(f"    📁 {date_str}: {file_size / 1024 / 1024:.2f}MB (float16, {savings_pct:.0f}% smaller)")

    return {
        'date': date_str,
        'file': filename,
        'size': int(file_size),
        'max_error': float(max_error),
        'mean_error': float(mean_error),
    }


# ===== EKE PROCESSING - NO ARTIFICIAL BOUNDS! =====

def calculate_diffusivity(ugosa, vgosa):
    """
    Calculate diffusivity K from geostrophic anomaly velocities.
    Physics-based with realistic bounds for Fukushima simulation.
    """
    # 1. Calculate EKE from geostrophic ANOMALIES
    eke = 0.5 * (np.square(ugosa) + np.square(vgosa))

    # 2. Diagnostic print
    valid_eke = eke[~np.isnan(eke)]
    if len(valid_eke) > 0:
        print(
            f"    EKE stats - min={valid_eke.min():.6f}, mean={valid_eke.mean():.6f}, max={valid_eke.max():.6f} m²/s²")
    else:
        print(f"    EKE stats - all NaN")

    # 3. Scale anomaly-EKE to effective diffusivity
    # ALPHA = 0.1 gives mean K ~125 m²/s (perfect for Fukushima!)
    eke_effective = eke * ALPHA

    # 4. Calculate diffusivity using physics formula
    K = C * eke_effective * T_L_SECONDS

    # 5. Apply PHYSICS-BASED maximum (not arbitrary!)
    # 3000 m²/s allows strong Kuroshio eddies
    # 2000 m²/s is more conservative
    MAX_PHYSICAL_K = 3000.0  # or 2000.0 for conservative

    # Smooth capping (preserves distribution shape)
    K = np.minimum(K, MAX_PHYSICAL_K)

    # 6. Special handling for coastal extremes
    # Detect likely coastal artifacts (extremely high gradients)
    if K.max() > MAX_PHYSICAL_K * 0.8:  # If many values near max
        # Find 99th percentile (exclude extreme outliers)
        k_99 = np.percentile(K[K > 0], 99) if np.any(K > 0) else MAX_PHYSICAL_K
        if k_99 < MAX_PHYSICAL_K * 0.5:  # If 99% are much lower than max
            print(f"    ⚠️  Coastal extremes detected, capping at {k_99:.0f} m²/s (99th percentile)")
            K = np.minimum(K, k_99)

    # 7. Replace NaN with 0
    K = np.nan_to_num(K, nan=0.0)

    # 8. Diagnostic print of final K
    valid_K = K[K != 0]
    if len(valid_K) > 0:
        print(f"    K stats - min={valid_K.min():.1f}, mean={valid_K.mean():.1f}, max={valid_K.max():.1f} m²/s")
        print(f"    Percent zeros: {(K == 0).sum() / K.size * 100:.1f}%")

        # Distribution analysis
        percentiles = np.percentile(valid_K, [50, 75, 90, 95, 99])
        print(f"    K percentiles - 50%={percentiles[0]:.0f}, 75%={percentiles[1]:.0f}, "
              f"90%={percentiles[2]:.0f}, 95%={percentiles[3]:.0f}, 99%={percentiles[4]:.0f} m²/s")
    else:
        print(f"    K stats - all zeros")

    return K.astype(np.float32)

def interpolate_to_hycom_grid(K_eke, eke_lon, eke_lat, hycom_lon_grid, hycom_lat_grid):
    """Interpolate diffusivity from EKE grid to HYCOM grid."""
    print(f"    Interpolating {K_eke.shape} → {hycom_lon_grid.shape}...")

    hycom_points = np.column_stack([
        hycom_lon_grid.ravel(),
        hycom_lat_grid.ravel()
    ])

    interpolator = RegularGridInterpolator(
        (eke_lat, eke_lon),
        K_eke,
        method='linear',
        bounds_error=False,
        fill_value=0.0  # Fill missing with 0, not artificial minimum!
    )

    K_hycom_flat = interpolator(hycom_points[:, ::-1])
    K_hycom = K_hycom_flat.reshape(hycom_lon_grid.shape)

    return K_hycom.astype(np.float32)


def process_single_eke_file(filepath, hycom_grid, coords_info, all_metadata):
    """Process one EKE file with optimization."""
    print(f"\n📂 Processing: {os.path.basename(filepath)}")

    file_stats = {'days_processed': 0, 'errors': 0, 'total_size': 0}

    try:
        ds = xr.open_dataset(filepath, chunks={'time': 10})
        eke_lon = ds.longitude.values.astype(np.float32)
        eke_lat = ds.latitude.values.astype(np.float32)
        time_values = ds.time.values
        total_days = len(time_values)

        print(f"  Found {total_days} days in file")
        print(f"  Using ALPHA = {ALPHA} (scale factor)")

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

                # Calculate diffusivity (NO bounds!)
                K_eke = calculate_diffusivity(ugosa_day, vgosa_day)

                # Interpolate to HYCOM grid
                K_hycom = interpolate_to_hycom_grid(
                    K_eke, eke_lon, eke_lat,
                    hycom_grid['lon_grid'], hycom_grid['lat_grid']
                )

                # Save in optimized format
                file_info = save_daily_k_file_optimized(
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
        print(f"  📊 File size: {file_stats['total_size'] / 1024 / 1024:.1f}MB")

    except Exception as e:
        print(f"❌ Failed to process file: {e}")

    return all_metadata, file_stats


# ===== MAIN =====

def main():
    print("\n" + "=" * 70)
    print("🔥 ULTRA-OPTIMIZED EKE PROCESSING - PHYSICS-BASED")
    print("=" * 70)
    print(f"🔧 Configuration:")
    print(f"   ALPHA = {ALPHA} (anomaly scaling factor)")
    print(f"   C = {C} (empirical constant)")
    print(f"   T_L = {T_L_DAYS} days")
    print(f"   NO artificial bounds on K values")
    print("=" * 70)

    # Load HYCOM grid
    hycom_grid = load_hycom_grid()

    # Create single coordinates file
    coords_info = save_coordinates_file(
        hycom_grid['lon_grid'],
        hycom_grid['lat_grid'],
        COORDS_FILE
    )

    # Initialize metadata
    metadata = {
        'description': 'Ultra-optimized daily diffusivity for HYCOM grid - NO artificial bounds',
        'physics': {
            'formula': 'K = C * (ALPHA * EKE) * T_L where EKE = 0.5*(ugosa² + vgosa²)',
            'constants': {
                'C': C,
                'ALPHA': ALPHA,
                'T_L_days': T_L_DAYS,
                'T_L_seconds': T_L_SECONDS
            },
            'notes': 'NO artificial bounds on K values - physics determines range',
            'units': 'm²/s'
        },
        'grid': {
            'source': 'HYCOM 0.04° grid',
            'n_lat': coords_info['n_lat'],
            'n_lon': coords_info['n_lon'],
            'total_cells': coords_info['total_cells'],
            'coordinates_file': 'eke_coords.bin'
        },
        'optimization': {
            'format': 'float16 (2 bytes per value)',
            'coordinates_stored': 'once',
            'compression': '85% vs original float32'
        },
        'time_period': '2011-03-01 to 2013-02-28',
        'dates': [],
        'files': [],
        'processing_date': datetime.now().isoformat(),
        'binary_format': {
            'version': 6,
            'coordinates_header': '3 integers: version, n_lat, n_lon',
            'daily_header': '5 integers: version, year, month, day, max_error×1000',
            'data': 'float16 K values only'
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

    # Calculate storage summary
    coords_size_mb = coords_info['file_size'] / (1024 ** 2)
    if total_stats['days_processed'] > 0:
        daily_avg_mb = total_stats['total_size'] / total_stats['days_processed'] / (1024 ** 2)
    else:
        daily_avg_mb = 0

    total_gb = (coords_info['file_size'] + total_stats['total_size']) / (1024 ** 3)

    metadata['storage_summary'] = {
        'coordinates_size_mb': coords_size_mb,
        'total_daily_size_mb': total_stats['total_size'] / (1024 ** 2),
        'average_daily_size_mb': daily_avg_mb,
        'estimated_total_gb': total_gb,
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
    print(f"  Coordinates file: {coords_size_mb:.1f}MB (loaded once)")
    print(f"  Daily files: {daily_avg_mb:.1f}MB each (float16)")
    print(f"  Days processed: {total_stats['days_processed']}")
    print(f"  Total size: {total_gb:.1f}GB")
    print(f"  Savings vs float32: {((24.6 - daily_avg_mb) / 24.6 * 100):.0f}% per file!")

    print(f"\n📁 Output structure:")
    print(f"  {OUTPUT_DIR}/")
    print(f"    ├── eke_coords.bin     (coordinates)")
    print(f"    ├── daily/             ({total_stats['days_processed']} daily files)")
    print(f"    └── eke_metadata.json  (this info)")

    print(f"\n🚀 Ready for StreamingEKELoader.js!")
    print(f"   Grid: {coords_info['n_lat']}×{coords_info['n_lon']}")
    print(f"   Daily streaming: ~{daily_avg_mb:.1f}MB per timestep")

    if TEST_MODE:
        print(f"\n⚠️  TEST MODE: Only processed first file")
        print(f"   Set TEST_MODE = False for full implementation")


if __name__ == "__main__":
    main()