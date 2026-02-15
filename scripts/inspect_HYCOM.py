import struct
import numpy as np
import os


def analyze_hycom_grid_detailed():
    """Detailed analysis of HYCOM grid to understand actual resolution."""

    filepath = "/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/data/currents_3d_bin/currents_2011_03_01.bin"

    with open(filepath, 'rb') as f:
        # Read header
        header = struct.unpack('5i', f.read(20))
        version, n_lat, n_lon, year, month = header

        print(f"HYCOM Grid Analysis:")
        print(f"  Version: {version}")
        print(f"  Dimensions: {n_lat} × {n_lon}")
        print(f"  Total cells: {n_lat * n_lon:,}")

        total_cells = n_lat * n_lon

        # Read coordinates
        lon_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)
        lat_array = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)

        lon_grid = lon_array.reshape((n_lat, n_lon))
        lat_grid = lat_array.reshape((n_lat, n_lon))

        # Calculate actual resolution
        lon_res = (lon_grid.max() - lon_grid.min()) / (n_lon - 1)
        lat_res = (lat_grid.max() - lat_grid.min()) / (n_lat - 1)

        print(f"\n📊 Coordinate ranges:")
        print(f"  Longitude: {lon_grid.min():.2f}° to {lon_grid.max():.2f}°")
        print(f"  Latitude: {lat_grid.min():.2f}° to {lat_grid.max():.2f}°")
        print(f"\n📏 Resolution:")
        print(f"  Longitude resolution: {lon_res:.4f}°")
        print(f"  Latitude resolution: {lat_res:.4f}°")

        # Check if resolution matches expected 0.04°
        expected_res = 0.04
        print(f"\n✅ Expected 0.04° resolution check:")
        print(f"  Longitude: {'✓' if abs(lon_res - expected_res) < 0.001 else '✗'} ({lon_res:.4f} vs {expected_res})")
        print(f"  Latitude: {'✓' if abs(lat_res - expected_res) < 0.001 else '✗'} ({lat_res:.4f} vs {expected_res})")

        # Calculate expected dimensions for your bounding box
        expected_n_lon = int(160 / expected_res) + 1  # = 4001
        expected_n_lat = int(65 / expected_res) + 1  # = 1626

        print(f"\n🔍 Dimension analysis:")
        print(f"  Actual: {n_lat} × {n_lon}")
        print(f"  Expected for 0.04°: {expected_n_lat} × {expected_n_lon}")

        if n_lon != expected_n_lon or n_lat != expected_n_lat:
            print(f"\n⚠️  Dimensions don't match expected 0.04° grid!")

            # Calculate actual resolution based on your dimensions
            actual_lon_res = 160 / (n_lon - 1)
            actual_lat_res = 65 / (n_lat - 1)
            print(f"\n📐 Based on your dimensions, actual resolution would be:")
            print(f"  Longitude: {actual_lon_res:.4f}°")
            print(f"  Latitude: {actual_lat_res:.4f}°")

        return {
            'n_lat': n_lat,
            'n_lon': n_lon,
            'lon_grid': lon_grid,
            'lat_grid': lat_grid,
            'lon_range': (lon_grid.min(), lon_grid.max()),
            'lat_range': (lat_grid.min(), lat_grid.max()),
            'lon_res': lon_res,
            'lat_res': lat_res
        }


# Run the analysis
grid_info = analyze_hycom_grid_detailed()