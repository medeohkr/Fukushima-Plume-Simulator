import numpy as np
import matplotlib.pyplot as plt
import matplotlib.cm as cm
import json
import struct
from pathlib import Path


def read_eke_day(date_key="20110311"):
    """
    Read a single day of EKE data from the ultra-optimized format

    Parameters:
    -----------
    date_key : str
        Date in YYYYMMDD format (default: March 11, 2011)

    Returns:
    --------
    dict with keys:
        'lons' : 1D array of longitudes
        'lats' : 1D array of latitudes
        'K' : 2D array of diffusivity (m²/s)
        'metadata' : dict with file metadata
    """

    # Paths
    base_path = Path("../web/data/eke_ultra_optimized")
    coords_file = base_path / "eke_coords.bin"
    data_file = base_path / f"daily/eke_{date_key}.bin"

    print(f"📁 Reading EKE data for {date_key}...")

    # 1. Read coordinates (once)
    with open(coords_file, 'rb') as f:
        # Read header
        version = struct.unpack('<i', f.read(4))[0]
        n_lat = struct.unpack('<i', f.read(4))[0]
        n_lon = struct.unpack('<i', f.read(4))[0]
        total_cells = n_lat * n_lon

        print(f"   Grid: {n_lat}×{n_lon} = {total_cells:,} cells")

        # Read longitude array
        lons = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)
        # Read latitude array
        lats = np.frombuffer(f.read(total_cells * 4), dtype=np.float32)

    # 2. Read EKE data for specific day
    with open(data_file, 'rb') as f:
        # Read header
        version = struct.unpack('<i', f.read(4))[0]
        year = struct.unpack('<i', f.read(4))[0]
        month = struct.unpack('<i', f.read(4))[0]
        day = struct.unpack('<i', f.read(4))[0]
        max_error_scaled = struct.unpack('<i', f.read(4))[0]
        max_error = max_error_scaled / 1000.0

        print(f"   Date: {year}-{month:02d}-{day:02d}")
        print(f"   Max error: {max_error:.3f}")

        # Read float16 data
        uint16_data = np.frombuffer(f.read(total_cells * 2), dtype=np.uint16)

    # 3. Convert float16 to float32
    def uint16_to_float32(uint16_arr):
        """Convert float16 (stored as uint16) to float32"""
        # Simple implementation - matches JavaScript version
        results = np.zeros_like(uint16_arr, dtype=np.float32)

        for i, val in enumerate(uint16_arr):
            if val == 0:
                results[i] = 0
                continue

            sign = -1 if (val & 0x8000) else 1
            exponent = (val >> 10) & 0x1F
            fraction = val & 0x3FF

            if exponent == 0:
                results[i] = sign * np.power(2, -14) * (fraction / 1024)
            elif exponent == 31:
                results[i] = np.nan if fraction != 0 else sign * np.inf
            else:
                results[i] = sign * np.power(2, exponent - 15) * (1 + fraction / 1024)

        return results

    K_flat = uint16_to_float32(uint16_data)

    # 4. Reshape to 2D grid
    K_grid = K_flat.reshape((n_lat, n_lon))

    # Apply bounds (20-500 m²/s like in your code)
    K_grid = np.clip(K_grid, 20, 500)

    # 5. Create longitude/latitude grids for plotting
    lon_grid = lons.reshape((n_lat, n_lon))
    lat_grid = lats.reshape((n_lat, n_lon))

    return {
        'lons': lon_grid,
        'lats': lat_grid,
        'K': K_grid,
        'metadata': {
            'date': f"{year}-{month:02d}-{day:02d}",
            'n_lat': n_lat,
            'n_lon': n_lon,
            'max_error': max_error,
            'version': version
        }
    }


def create_eke_heatmap(date_key="20110311", region=None):
    """
    Create a heatmap visualization of EKE values

    Parameters:
    -----------
    date_key : str
        Date in YYYYMMDD format
    region : tuple or None
        (lon_min, lon_max, lat_min, lat_max) for zoom
        Default: Full Pacific (100°E-260°E, 0°N-60°N)
    """

    # Read data
    data = read_eke_day(date_key)
    lons = data['lons']
    lats = data['lats']
    K = data['K']

    # Set region if not specified
    if region is None:
        # Fukushima-centered region
        region = (120, 180, 20, 55)  # Japan to mid-Pacific

    # Create mask for region
    mask = ((lons >= region[0]) & (lons <= region[1]) &
            (lats >= region[2]) & (lats <= region[3]))

    if not mask.any():
        print("❌ No data in specified region!")
        return

    # Apply mask
    plot_lons = lons[mask]
    plot_lats = lats[mask]
    plot_K = K[mask]

    # Create figure
    fig, axes = plt.subplots(2, 2, figsize=(16, 12))
    fig.suptitle(f'EKE Diffusivity - {data["metadata"]["date"]}', fontsize=16, fontweight='bold')

    # 1. Full Pacific Heatmap
    ax1 = axes[0, 0]
    sc1 = ax1.scatter(lons.ravel(), lats.ravel(), c=K.ravel(),
                      cmap='jet', s=1, alpha=0.6, vmin=20, vmax=500)
    ax1.set_title('Full Pacific Domain')
    ax1.set_xlabel('Longitude')
    ax1.set_ylabel('Latitude')
    ax1.set_xlim(100, 260)
    ax1.set_ylim(0, 60)
    ax1.grid(True, alpha=0.3)
    plt.colorbar(sc1, ax=ax1, label='Diffusivity K (m²/s)')

    # Add Japan outline
    ax1.plot([141.0, 141.0], [35.0, 40.0], 'r-', linewidth=2, label='Japan Coast')
    ax1.scatter(141.0, 37.4, c='red', s=100, marker='*', label='Fukushima')

    # 2. Japan Region (zoomed)
    ax2 = axes[0, 1]
    sc2 = ax2.scatter(plot_lons, plot_lats, c=plot_K,
                      cmap='jet', s=2, alpha=0.8, vmin=20, vmax=500)
    ax2.set_title('Japan Region (Zoomed)')
    ax2.set_xlabel('Longitude')
    ax2.set_ylabel('Latitude')
    ax2.set_xlim(region[0], region[1])
    ax2.set_ylim(region[2], region[3])
    ax2.grid(True, alpha=0.3)
    plt.colorbar(sc2, ax=ax2, label='Diffusivity K (m²/s)')

    # Add coastlines and Fukushima
    ax2.plot([130, 145], [35, 35], 'k-', linewidth=1, alpha=0.5)  # Approx Honshu south
    ax2.plot([130, 145], [41, 41], 'k-', linewidth=1, alpha=0.5)  # Approx Honshu north
    ax2.scatter(141.0, 37.4, c='red', s=200, marker='*', edgecolor='black', label='Fukushima')

    # 3. Histogram of K values
    ax3 = axes[1, 0]
    valid_K = K[(K >= 20) & (K <= 500)]
    ax3.hist(valid_K.ravel(), bins=50, edgecolor='black', alpha=0.7)
    ax3.set_title(f'Distribution of K values (mean: {valid_K.mean():.1f} m²/s)')
    ax3.set_xlabel('Diffusivity K (m²/s)')
    ax3.set_ylabel('Frequency')
    ax3.grid(True, alpha=0.3)

    # Add vertical lines for key values
    ax3.axvline(20, color='red', linestyle='--', label='Min (20)')
    ax3.axvline(200, color='orange', linestyle='--', label='Typical (200)')
    ax3.axvline(500, color='purple', linestyle='--', label='Max (500)')
    ax3.legend()

    # 4. Map of EKE "hotspots" near Japan coast
    ax4 = axes[1, 1]

    # Find high-diffusivity areas near coast (where particles might get pushed)
    coastal_mask = ((lons >= 130) & (lons <= 145) &
                    (lats >= 30) & (lats <= 45) &
                    (K > 300))  # High diffusion areas

    if coastal_mask.any():
        coastal_lons = lons[coastal_mask]
        coastal_lats = lats[coastal_mask]
        coastal_K = K[coastal_mask]

        sc4 = ax4.scatter(coastal_lons, coastal_lats, c=coastal_K,
                          cmap='hot', s=20, alpha=0.8, vmin=300, vmax=500)
        ax4.set_title('High-Diffusion Areas (>300 m²/s) Near Japan Coast')
        ax4.set_xlabel('Longitude')
        ax4.set_ylabel('Latitude')
        ax4.set_xlim(130, 145)
        ax4.set_ylim(30, 45)
        ax4.grid(True, alpha=0.3)
        plt.colorbar(sc4, ax=ax4, label='Diffusivity K (m²/s)')

        # Add Fukushima and your release box
        ax4.scatter(141.0, 37.4, c='red', s=300, marker='*', edgecolor='black', zorder=5)

        # Draw your release box
        release_box = {
            'minLon': 142.0, 'maxLon': 142.5,
            'minLat': 36.5, 'maxLat': 37.5
        }
        ax4.add_patch(plt.Rectangle(
            (release_box['minLon'], release_box['minLat']),
            release_box['maxLon'] - release_box['minLon'],
            release_box['maxLat'] - release_box['minLat'],
            fill=False, edgecolor='green', linewidth=2, linestyle='--',
            label='Release Box'
        ))

        # Draw approximate Japan coastline
        japan_lons = [141.0, 140.5, 139.5, 138.0, 136.0, 135.0, 134.0, 133.0, 132.0, 131.0]
        japan_lats = [37.4, 36.0, 35.0, 34.5, 34.0, 33.5, 33.0, 32.5, 32.0, 31.5]
        ax4.plot(japan_lons, japan_lats, 'k-', linewidth=2, label='Japan Coast')

    else:
        ax4.text(0.5, 0.5, 'No high-diffusion areas\nin coastal region',
                 ha='center', va='center', transform=ax4.transAxes, fontsize=12)
        ax4.set_title('High-Diffusion Areas Near Japan Coast')

    ax4.legend(loc='upper right')

    plt.tight_layout()

    # Save figure
    output_file = f"eke_heatmap_{date_key}.png"
    plt.savefig(output_file, dpi=150, bbox_inches='tight')
    print(f"✅ Saved heatmap to: {output_file}")

    # Display statistics
    print("\n📊 EKE Statistics:")
    print(f"   Global min: {K.min():.1f} m²/s")
    print(f"   Global max: {K.max():.1f} m²/s")
    print(f"   Global mean: {K.mean():.1f} m²/s")
    print(f"   Japan region mean: {plot_K.mean():.1f} m²/s")

    # Check for problematic coastal values
    coastal_region = ((lons >= 135) & (lons <= 142) &
                      (lats >= 34) & (lats <= 40))
    if coastal_region.any():
        coastal_K_vals = K[coastal_region]
        print(f"\n⚠️  Coastal Japan (135-142°E, 34-40°N):")
        print(f"   Min: {coastal_K_vals.min():.1f} m²/s")
        print(f"   Max: {coastal_K_vals.max():.1f} m²/s")
        print(f"   Mean: {coastal_K_vals.mean():.1f} m²/s")

        # High diffusion near coast could explain particle behavior
        high_coastal = coastal_K_vals[coastal_K_vals > 300]
        if len(high_coastal) > 0:
            print(f"   Areas with K > 300 m²/s: {len(high_coastal)} cells")
            print(f"   This high coastal diffusion could push particles toward land!")

    plt.show()

    return data


def compare_multiple_days(date_keys=["20110311", "20110411", "20110711"]):
    """Compare EKE patterns across different days"""

    fig, axes = plt.subplots(1, len(date_keys), figsize=(5 * len(date_keys), 4))

    for idx, date_key in enumerate(date_keys):
        try:
            data = read_eke_day(date_key)
            lons = data['lons']
            lats = data['lats']
            K = data['K']

            # Japan region
            mask = ((lons >= 130) & (lons <= 150) &
                    (lats >= 30) & (lats <= 45))

            if mask.any():
                ax = axes[idx] if len(date_keys) > 1 else axes
                sc = ax.scatter(lons[mask], lats[mask], c=K[mask],
                                cmap='jet', s=1, alpha=0.7, vmin=20, vmax=500)
                ax.set_title(f'{date_key}')
                ax.set_xlabel('Longitude')
                if idx == 0:
                    ax.set_ylabel('Latitude')
                ax.set_xlim(130, 150)
                ax.set_ylim(30, 45)
                ax.grid(True, alpha=0.3)

                # Add Fukushima
                ax.scatter(141.0, 37.4, c='red', s=50, marker='*')

        except Exception as e:
            print(f"❌ Error reading {date_key}: {e}")
            if len(date_keys) > 1:
                axes[idx].text(0.5, 0.5, f"Error\n{date_key}",
                               ha='center', va='center')
            else:
                axes.text(0.5, 0.5, f"Error\n{date_key}",
                          ha='center', va='center')

    plt.tight_layout()
    plt.savefig("eke_multiday_comparison.png", dpi=150, bbox_inches='tight')
    plt.show()


if __name__ == "__main__":
    # Generate heatmap for March 11, 2011 (day 0)
    print("=" * 60)
    print("EKE DIFFUSIVITY HEATMAP GENERATOR")
    print("=" * 60)

    # Single day analysis
    data = create_eke_heatmap("20110311", region=(130, 150, 30, 45))

    # Optional: Compare multiple days
    # compare_multiple_days(["20110311", "20110611", "20110911"])

    print("\n🔍 Look for:")
    print("1. High K values (>300 m²/s) near Japan coast")
    print("2. Spatial patterns that could push particles landward")
    print("3. How diffusion magnitude compares to HYCOM advection")