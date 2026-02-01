# hycom_heatmap.py
"""
Create heatmaps of HYCOM current speed and direction.
Shows actual patterns, not just sparse arrows.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import struct
import os
from pathlib import Path
from datetime import datetime
import json

# === CONFIGURATION ===
BINARY_DIR = "../web/data/currents_bin"  # Update path
OUTPUT_DIR = "../web/data/current_heatmaps"

# Region (will be adjusted based on actual data bounds)
REGION = None  # Will auto-detect

# Visualization settings
DPI = 300
COLORMAP_SPEED = 'viridis'  # For speed magnitude
COLORMAP_DIRECTION = 'hsv'  # For current direction (cyclic)


# === CORE FUNCTIONS ===

def detect_grid_bounds():
    """Auto-detect the actual bounds of HYCOM grid"""
    print("Detecting HYCOM grid bounds...")

    # Find first binary file
    files = list(Path(BINARY_DIR).glob("*.bin"))
    if not files:
        raise FileNotFoundError(f"No .bin files found in {BINARY_DIR}")

    filepath = files[0]
    print(f"  Using: {filepath.name}")

    with open(filepath, 'rb') as f:
        header = struct.unpack('5i', f.read(20))
        version, n_lat, n_lon, year, month = header
        total_cells = n_lat * n_lon

        # Read coordinates
        lon_bytes = f.read(total_cells * 4)
        lat_bytes = f.read(total_cells * 4)

    # Convert to arrays
    lon_2d = np.frombuffer(lon_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    lat_2d = np.frombuffer(lat_bytes, dtype=np.float32).reshape(n_lat, n_lon)

    # Find valid (non-NaN) coordinates
    valid_mask = ~np.isnan(lon_2d) & ~np.isnan(lat_2d)
    lon_valid = lon_2d[valid_mask]
    lat_valid = lat_2d[valid_mask]

    if len(lon_valid) == 0:
        raise ValueError("No valid coordinates found in file")

    # Calculate bounds
    lon_min, lon_max = lon_valid.min(), lon_valid.max()
    lat_min, lat_max = lat_valid.min(), lat_valid.max()

    print(f"  Grid shape: {n_lat}x{n_lon}")
    print(f"  Longitude: [{lon_min:.2f}°, {lon_max:.2f}°]")
    print(f"  Latitude: [{lat_min:.2f}°, {lat_max:.2f}°]")

    # Find Fukushima coordinates
    fukushima_lon = 141.6
    fukushima_lat = 37.4

    # Calculate reasonable region around Fukushima
    region_padding = 5.0  # degrees

    region = {
        'lon_min': max(lon_min, fukushima_lon - region_padding),
        'lon_max': min(lon_max, fukushima_lon + region_padding),
        'lat_min': max(lat_min, fukushima_lat - region_padding),
        'lat_max': min(lat_max, fukushima_lat + region_padding)
    }

    print(f"\nAuto-detected region around Fukushima:")
    print(f"  Longitude: [{region['lon_min']:.2f}°, {region['lon_max']:.2f}°]")
    print(f"  Latitude: [{region['lat_min']:.2f}°, {region['lat_max']:.2f}°]")

    return region, n_lat, n_lon


def load_month_data(filepath, region):
    """Load and crop data for a single month"""
    print(f"  Loading: {filepath.name}")

    with open(filepath, 'rb') as f:
        # Read header
        header = struct.unpack('5i', f.read(20))
        version, n_lat, n_lon, year, month = header
        total_cells = n_lat * n_lon

        # Read all data
        lon_bytes = f.read(total_cells * 4)
        lat_bytes = f.read(total_cells * 4)
        u_bytes = f.read(total_cells * 4)
        v_bytes = f.read(total_cells * 4)

    # Convert to arrays
    lon_2d = np.frombuffer(lon_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    lat_2d = np.frombuffer(lat_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    u_2d = np.frombuffer(u_bytes, dtype=np.float32).reshape(n_lat, n_lon)
    v_2d = np.frombuffer(v_bytes, dtype=np.float32).reshape(n_lat, n_lon)

    # Crop to region
    mask = ((lon_2d >= region['lon_min']) & (lon_2d <= region['lon_max']) &
            (lat_2d >= region['lat_min']) & (lat_2d <= region['lat_max']))

    rows, cols = np.where(mask)

    if len(rows) == 0:
        print(f"    ⚠️ No data in region, using full grid")
        return lon_2d, lat_2d, u_2d, v_2d, year, month

    # Crop arrays
    row_min, row_max = rows.min(), rows.max()
    col_min, col_max = cols.min(), cols.max()

    lon_crop = lon_2d[row_min:row_max + 1, col_min:col_max + 1]
    lat_crop = lat_2d[row_min:row_max + 1, col_min:col_max + 1]
    u_crop = u_2d[row_min:row_max + 1, col_min:col_max + 1]
    v_crop = v_2d[row_min:row_max + 1, col_min:col_max + 1]

    print(f"    Cropped: {lon_crop.shape[0]}x{lon_crop.shape[1]}")

    return lon_crop, lat_crop, u_crop, v_crop, year, month


def create_heatmap(lon_2d, lat_2d, u_2d, v_2d, year, month, output_dir):
    """Create comprehensive heatmap visualization"""
    print(f"  Creating heatmap: {year}-{month:02d}")

    # Calculate speed and direction
    speed = np.sqrt(u_2d ** 2 + v_2d ** 2)
    direction = np.arctan2(v_2d, u_2d)  # radians, -π to π

    # Convert direction to degrees (0-360)
    direction_deg = np.degrees(direction) % 360

    # Create figure with 3 subplots
    fig = plt.figure(figsize=(18, 10))

    # === 1. SPEED HEATMAP ===
    ax1 = plt.subplot(2, 3, (1, 2))

    # Mask land (NaN values)
    speed_masked = np.ma.array(speed, mask=np.isnan(speed))

    # Create contourf plot
    contour = ax1.contourf(lon_2d, lat_2d, speed_masked,
                           levels=50, cmap=COLORMAP_SPEED,
                           alpha=0.9, extend='both')

    # Add contour lines
    ax1.contour(lon_2d, lat_2d, speed_masked,
                levels=10, colors='black', linewidths=0.5, alpha=0.5)

    # Add colorbar
    cbar1 = plt.colorbar(contour, ax=ax1, shrink=0.8)
    cbar1.set_label('Current Speed (m/s)', fontsize=11)

    # Add Fukushima marker
    ax1.plot(141.6, 37.4, 'r*', markersize=15, markeredgecolor='black',
             label='Fukushima Daiichi', zorder=10)

    # Formatting
    ax1.set_xlabel('Longitude (°E)', fontsize=12)
    ax1.set_ylabel('Latitude (°N)', fontsize=12)
    ax1.set_title(f'HYCOM Current Speed - {datetime(year, month, 1).strftime("%B %Y")}',
                  fontsize=14, fontweight='bold')
    ax1.grid(True, alpha=0.3, linestyle='--')
    ax1.legend(loc='upper right')

    # === 2. DIRECTION HEATMAP (Hue = direction, Value = speed) ===
    ax2 = plt.subplot(2, 3, 3)

    # Create HSV color: Hue from direction, Value from normalized speed
    norm_speed = speed_masked / np.nanmax(speed) if np.nanmax(speed) > 0 else speed_masked
    hsv_colors = np.zeros((*speed.shape, 3))

    # Convert to HSV (direction -> hue, speed -> value, saturation = 1)
    for i in range(speed.shape[0]):
        for j in range(speed.shape[1]):
            if not np.isnan(speed[i, j]):
                # Normalize direction to [0, 1] for hue
                hue = direction_deg[i, j] / 360.0
                # Use speed for value (brightness)
                value = min(1.0, norm_speed[i, j] * 2)  # Boost visibility
                # Convert HSV to RGB
                hsv_colors[i, j] = mcolors.hsv_to_rgb([hue, 1.0, value])

    # Plot the direction heatmap
    ax2.imshow(hsv_colors, extent=[lon_2d.min(), lon_2d.max(),
                                   lat_2d.min(), lat_2d.max()],
               origin='lower', aspect='auto')

    # Add direction color wheel
    ax2.plot(141.6, 37.4, 'r*', markersize=10, markeredgecolor='black')
    ax2.set_xlabel('Longitude (°E)', fontsize=12)
    ax2.set_ylabel('Latitude (°N)', fontsize=12)
    ax2.set_title('Current Direction (HSV)', fontsize=13)
    ax2.grid(True, alpha=0.3)

    # === 3. SPEED HISTOGRAM ===
    ax3 = plt.subplot(2, 3, 4)

    # Histogram of speeds
    speed_valid = speed[~np.isnan(speed)]
    if len(speed_valid) > 0:
        ax3.hist(speed_valid.flatten(), bins=50,
                 color='steelblue', edgecolor='black', alpha=0.7)
        ax3.axvline(np.nanmean(speed), color='red', linestyle='--',
                    linewidth=2, label=f'Mean: {np.nanmean(speed):.3f} m/s')
        ax3.axvline(np.nanmax(speed), color='orange', linestyle=':',
                    linewidth=2, label=f'Max: {np.nanmax(speed):.3f} m/s')

    ax3.set_xlabel('Speed (m/s)', fontsize=11)
    ax3.set_ylabel('Frequency', fontsize=11)
    ax3.set_title('Speed Distribution', fontsize=13)
    ax3.legend()
    ax3.grid(True, alpha=0.3)

    # === 4. VECTOR FIELD (sparse for clarity) ===
    ax4 = plt.subplot(2, 3, 5)

    # Sample every 10th point for vectors
    step = max(1, min(lon_2d.shape) // 30)  # Dynamic step based on grid size

    if step > 0:
        lon_sampled = lon_2d[::step, ::step]
        lat_sampled = lat_2d[::step, ::step]
        u_sampled = u_2d[::step, ::step]
        v_sampled = v_2d[::step, ::step]

        # Filter out NaN
        valid = ~np.isnan(u_sampled) & ~np.isnan(v_sampled)

        if np.any(valid):
            # Quiver plot with color by speed
            speed_sampled = np.sqrt(u_sampled ** 2 + v_sampled ** 2)
            norm = mcolors.Normalize(vmin=0, vmax=np.nanmax(speed_sampled))

            quiver = ax4.quiver(lon_sampled[valid], lat_sampled[valid],
                                u_sampled[valid], v_sampled[valid],
                                speed_sampled[valid], cmap='plasma',
                                scale=30, width=0.003, pivot='mid')

            # Add colorbar for quiver
            cbar4 = plt.colorbar(quiver, ax=ax4, shrink=0.8)
            cbar4.set_label('Speed (m/s)', fontsize=10)

    ax4.plot(141.6, 37.4, 'r*', markersize=10, markeredgecolor='black')
    ax4.set_xlabel('Longitude (°E)', fontsize=11)
    ax4.set_ylabel('Latitude (°N)', fontsize=11)
    ax4.set_title('Vector Field (Subsampled)', fontsize=13)
    ax4.grid(True, alpha=0.3)

    # === 5. STATISTICS TEXT ===
    ax5 = plt.subplot(2, 3, 6)
    ax5.axis('off')

    # Calculate statistics
    stats_text = f"""
    HYCOM GLBa0.08 Statistics
    =========================

    Date: {datetime(year, month, 1).strftime("%B %Y")}
    Grid: {lon_2d.shape[1]}×{lon_2d.shape[0]}

    Speed Statistics:
    • Mean: {np.nanmean(speed):.4f} m/s
    • Median: {np.nanmedian(speed):.4f} m/s
    • Maximum: {np.nanmax(speed):.4f} m/s
    • Minimum: {np.nanmin(speed):.4f} m/s
    • Std Dev: {np.nanstd(speed):.4f} m/s

    Ocean Coverage:
    • Total cells: {lon_2d.size:,}
    • Ocean cells: {np.sum(~np.isnan(speed)):,}
    • Land cells: {np.sum(np.isnan(speed)):,}
    • Ocean %: {np.sum(~np.isnan(speed)) / lon_2d.size * 100:.1f}%

    Region:
    • Lon: [{lon_2d.min():.2f}°, {lon_2d.max():.2f}°E]
    • Lat: [{lat_2d.min():.2f}°, {lat_2d.max():.2f}°N]

    Data Source:
    • HYCOM GLBa0.08
    • Surface currents
    • Version: Binary v2
    """

    ax5.text(0.02, 0.98, stats_text, transform=ax5.transAxes,
             fontsize=9, verticalalignment='top',
             bbox=dict(boxstyle='round', facecolor='lightgray', alpha=0.8),
             fontfamily='monospace')

    # Adjust layout
    plt.tight_layout()

    # Save figure
    output_filename = f"currents_heatmap_{year}_{month:02d}.png"
    output_path = os.path.join(output_dir, output_filename)
    plt.savefig(output_path, dpi=DPI, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)

    print(f"    Saved: {output_filename}")

    # Return statistics
    return {
        'year': year,
        'month': month,
        'mean_speed': float(np.nanmean(speed)),
        'max_speed': float(np.nanmax(speed)),
        'min_speed': float(np.nanmin(speed)),
        'std_speed': float(np.nanstd(speed)),
        'ocean_cells': int(np.sum(~np.isnan(speed))),
        'total_cells': int(lon_2d.size)
    }


def create_single_panel_heatmap(lon_2d, lat_2d, u_2d, v_2d, year, month, output_dir):
    """Create a simple, clean single-panel heatmap for web use"""
    print(f"  Creating simple heatmap: {year}-{month:02d}")

    # Calculate speed
    speed = np.sqrt(u_2d ** 2 + v_2d ** 2)

    # Create figure
    fig, ax = plt.subplots(figsize=(12, 8))

    # Speed heatmap
    speed_masked = np.ma.array(speed, mask=np.isnan(speed))
    contour = ax.contourf(lon_2d, lat_2d, speed_masked,
                          levels=40, cmap='plasma',
                          alpha=0.9, extend='both')

    # Add contour lines for key speeds
    CS = ax.contour(lon_2d, lat_2d, speed_masked,
                    levels=[0.1, 0.25, 0.5, 0.75, 1.0],
                    colors='white', linewidths=1.0, alpha=0.7)
    ax.clabel(CS, inline=True, fontsize=9, fmt='%.2f m/s')

    # Add sparse vectors for direction
    step = max(1, min(lon_2d.shape) // 40)
    if step > 0:
        lon_sampled = lon_2d[::step, ::step]
        lat_sampled = lat_2d[::step, ::step]
        u_sampled = u_2d[::step, ::step]
        v_sampled = v_2d[::step, ::step]

        valid = ~np.isnan(u_sampled) & ~np.isnan(v_sampled)
        if np.any(valid):
            ax.quiver(lon_sampled[valid], lat_sampled[valid],
                      u_sampled[valid], v_sampled[valid],
                      color='white', scale=50, width=0.002,
                      headwidth=3, headlength=5, pivot='mid')

    # Add Fukushima marker
    ax.plot(141.6, 37.4, 'r*', markersize=20, markeredgecolor='black',
            label='Fukushima Daiichi', zorder=10)

    # Add coastline approximation (simple box for land)
    # You could add real coastlines with cartopy if available
    ax.add_patch(plt.Rectangle((lon_2d.min(), lat_2d.min()),
                               lon_2d.max() - lon_2d.min(),
                               lat_2d.max() - lat_2d.min(),
                               fill=False, edgecolor='gray',
                               linewidth=1, linestyle='--'))

    # Colorbar
    cbar = plt.colorbar(contour, ax=ax, shrink=0.8)
    cbar.set_label('Current Speed (m/s)', fontsize=12)

    # Formatting
    ax.set_xlabel('Longitude (°E)', fontsize=12)
    ax.set_ylabel('Latitude (°N)', fontsize=12)
    ax.set_title(f'HYCOM Surface Currents - {datetime(year, month, 1).strftime("%B %Y")}',
                 fontsize=14, fontweight='bold')
    ax.grid(True, alpha=0.3, linestyle=':')
    ax.legend(loc='upper right')

    # Add text box with stats
    stats_text = f"Mean: {np.nanmean(speed):.3f} m/s\nMax: {np.nanmax(speed):.3f} m/s"
    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
            fontsize=10, verticalalignment='top',
            bbox=dict(boxstyle='round', facecolor='white', alpha=0.8))

    # Save
    output_filename = f"currents_simple_{year}_{month:02d}.png"
    output_path = os.path.join(output_dir, output_filename)
    plt.savefig(output_path, dpi=DPI, bbox_inches='tight',
                facecolor='#0a1929', edgecolor='none')
    plt.close(fig)

    print(f"    Saved: {output_filename}")
    return output_filename


def generate_all_heatmaps():
    """Generate heatmaps for all months"""
    print("=" * 70)
    print("GENERATING HYCOM HEATMAPS")
    print("=" * 70)

    # Create output directories
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    detailed_dir = os.path.join(OUTPUT_DIR, "detailed")
    simple_dir = os.path.join(OUTPUT_DIR, "simple")
    os.makedirs(detailed_dir, exist_ok=True)
    os.makedirs(simple_dir, exist_ok=True)

    # Auto-detect grid bounds
    try:
        region, n_lat, n_lon = detect_grid_bounds()
    except Exception as e:
        print(f"❌ Failed to detect grid bounds: {e}")
        # Use default region
        region = {
            'lon_min': 140.0,
            'lon_max': 143.0,
            'lat_min': 36.0,
            'lat_max': 39.0
        }
        print(f"Using default region: {region}")

    # Find all combined binary files (skip separate U/V files)
    binary_dir = Path(BINARY_DIR)
    all_files = sorted(binary_dir.glob("currents_*.bin"))

    # Filter out U and V component files
    combined_files = [f for f in all_files if 'currents_u_' not in f.name and 'currents_v_' not in f.name]

    if not combined_files:
        print("No combined binary files found. Looking for any .bin files...")
        combined_files = all_files

    print(f"\nFound {len(combined_files)} files to process")

    all_stats = []

    for i, filepath in enumerate(combined_files):
        print(f"\n[{i + 1}/{len(combined_files)}] Processing {filepath.name}")

        try:
            # Load data
            lon_2d, lat_2d, u_2d, v_2d, year, month = load_month_data(filepath, region)

            # Skip if no data
            if np.all(np.isnan(u_2d)):
                print(f"  ⚠️ All NaN values, skipping")
                continue

            # Create detailed heatmap (3x2 panel)
            stats = create_heatmap(lon_2d, lat_2d, u_2d, v_2d, year, month, detailed_dir)
            all_stats.append(stats)

            # Create simple heatmap (single panel)
            create_single_panel_heatmap(lon_2d, lat_2d, u_2d, v_2d, year, month, simple_dir)

        except Exception as e:
            print(f"  ❌ Error: {e}")
            import traceback
            traceback.print_exc()
            continue

    # Save statistics
    if all_stats:
        stats_file = os.path.join(OUTPUT_DIR, "heatmap_statistics.json")
        with open(stats_file, 'w') as f:
            json.dump(all_stats, f, indent=2)

        # Create summary visualization
        create_summary_plot(all_stats, OUTPUT_DIR)

        print(f"\n" + "=" * 70)
        print(f"✅ Generated {len(all_stats)} heatmaps")
        print(f"Detailed maps: {detailed_dir}")
        print(f"Simple maps: {simple_dir}")
        print(f"Statistics: {stats_file}")

        # Print summary
        avg_speed = np.mean([s['mean_speed'] for s in all_stats])
        max_speed = np.max([s['max_speed'] for s in all_stats])
        print(f"\nSummary:")
        print(f"  Average speed across all months: {avg_speed:.4f} m/s")
        print(f"  Maximum speed observed: {max_speed:.4f} m/s")

    return all_stats


def create_summary_plot(all_stats, output_dir):
    """Create summary plot of monthly statistics"""
    months = [f"{s['year']}-{s['month']:02d}" for s in all_stats]
    mean_speeds = [s['mean_speed'] for s in all_stats]
    max_speeds = [s['max_speed'] for s in all_stats]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10))

    # Line plot of mean speeds
    ax1.plot(months, mean_speeds, 'o-', linewidth=2, markersize=8,
             color='steelblue', label='Mean Speed')
    ax1.fill_between(range(len(months)), mean_speeds, alpha=0.3, color='steelblue')
    ax1.set_ylabel('Mean Speed (m/s)', fontsize=12)
    ax1.set_title('Monthly HYCOM Current Speed Statistics', fontsize=14, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.legend()

    # Bar plot of max speeds
    ax2.bar(months, max_speeds, color='coral', alpha=0.7, edgecolor='black')
    ax2.set_ylabel('Max Speed (m/s)', fontsize=12)
    ax2.set_xlabel('Month', fontsize=12)
    ax2.grid(True, alpha=0.3)

    # Rotate x-axis labels
    plt.setp(ax1.xaxis.get_majorticklabels(), rotation=45)
    plt.setp(ax2.xaxis.get_majorticklabels(), rotation=45)

    plt.tight_layout()

    # Save
    summary_path = os.path.join(output_dir, "currents_monthly_summary.png")
    plt.savefig(summary_path, dpi=DPI, bbox_inches='tight')
    plt.close()

    print(f"Summary plot: {summary_path}")


# === MAIN EXECUTION ===
if __name__ == "__main__":
    print("HYCOM Heatmap Generator")
    print("=" * 70)

    # Generate all heatmaps
    generate_all_heatmaps()

    print("\n" + "=" * 70)
    print("DONE! Heatmaps generated successfully.")
    print("Check the output directory for:")
    print("1. Detailed multi-panel heatmaps (detailed/)")
    print("2. Simple single-panel heatmaps (simple/)")
    print("3. Monthly statistics summary")
    print("=" * 70)