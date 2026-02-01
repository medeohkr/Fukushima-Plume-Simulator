# debug_fukushima_currents.py
"""
Debug tool: Show EXACTLY what's happening at Fukushima coordinates.
High-resolution zoom with grid cell overlay.
"""

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import struct
import os
from pathlib import Path
from datetime import datetime

# === CONFIGURATION ===
BINARY_DIR = "../web/data/currents_bin"

# Fukushima coordinates
FUKUSHIMA_LON = 141.6
FUKUSHIMA_LAT = 37.4

# Your problematic coordinates
PROBLEM_COORDS = [
    (141.08, 37.40, "Your old minLon"),
    (141.21, 37.40, "Your new minLon"),
    (141.41, 37.40, "Your maxLon"),
    (141.60, 37.40, "Fukushima exact")
]


# === LOAD DATA ===

def load_first_month():
    """Load the first month's data"""
    files = sorted(Path(BINARY_DIR).glob("currents_*.bin"))
    if not files:
        files = sorted(Path(BINARY_DIR).glob("currents_u_*.bin"))

    if not files:
        raise FileNotFoundError(f"No .bin files in {BINARY_DIR}")

    filepath = files[0]
    print(f"Loading: {filepath.name}")

    with open(filepath, 'rb') as f:
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

    print(f"Grid: {n_lat}x{n_lon}, Date: {year}-{month:02d}")
    print(f"Lon range: [{lon_2d.min():.2f}, {lon_2d.max():.2f}]")
    print(f"Lat range: [{lat_2d.min():.2f}, {lat_2d.max():.2f}]")

    return lon_2d, lat_2d, u_2d, v_2d, year, month, n_lat, n_lon


def find_grid_cells(lon_2d, lat_2d, coordinates):
    """Find the exact grid cell for each coordinate"""
    results = []

    for target_lon, target_lat, label in coordinates:
        # Find closest grid cell
        distances = (lon_2d - target_lon) ** 2 + (lat_2d - target_lat) ** 2
        min_idx = np.unravel_index(np.argmin(distances), distances.shape)
        i, j = min_idx

        # Get exact grid cell values
        cell_lon = lon_2d[i, j]
        cell_lat = lat_2d[i, j]
        distance_km = np.sqrt(distances[i, j]) * 111.0  # Approx km

        results.append({
            'target': (target_lon, target_lat),
            'label': label,
            'grid_cell': (i, j),
            'actual_coords': (cell_lon, cell_lat),
            'distance_error': distance_km,
            'is_ocean': not np.isnan(lon_2d[i, j])
        })

    return results


# === CREATE DEBUG VISUALIZATION ===

def create_debug_map(lon_2d, lat_2d, u_2d, v_2d, grid_cells, year, month):
    """Create detailed debug map with grid overlay"""

    # Calculate speed
    speed = np.sqrt(u_2d ** 2 + v_2d ** 2)

    # Create figure with multiple zoom levels
    fig = plt.figure(figsize=(20, 15))

    # === 1. WIDE VIEW (Kuroshio context) ===
    ax1 = plt.subplot(3, 3, (1, 2))

    # Full region heatmap
    speed_masked = np.ma.array(speed, mask=np.isnan(speed))
    contour1 = ax1.contourf(lon_2d, lat_2d, speed_masked,
                            levels=40, cmap='plasma', alpha=0.8)

    # Add Kuroshio path (approximate)
    kuroshio_lons = np.linspace(130, 145, 100)
    kuroshio_lats = 35 + 5 * np.sin(np.radians(kuroshio_lons - 135))
    ax1.plot(kuroshio_lons, kuroshio_lats, 'cyan', linewidth=2,
             linestyle='--', alpha=0.7, label='Kuroshio approx path')

    # Mark Fukushima and problem points
    for cell in grid_cells:
        color = 'green' if 'old' not in cell['label'] else 'red'
        ax1.plot(cell['target'][0], cell['target'][1],
                 color=color, marker='o', markersize=8,
                 label=f"{cell['label']}")

    ax1.plot(FUKUSHIMA_LON, FUKUSHIMA_LAT, 'r*', markersize=15,
             markeredgecolor='black', label='Fukushima Daiichi')

    ax1.set_xlabel('Longitude (°E)', fontsize=12)
    ax1.set_ylabel('Latitude (°N)', fontsize=12)
    ax1.set_title(f'Wide View - Kuroshio Context\n{datetime(year, month, 1).strftime("%B %Y")}',
                  fontsize=14, fontweight='bold')
    ax1.grid(True, alpha=0.3)
    ax1.legend(loc='upper right', fontsize=9)

    # === 2. MEDIUM ZOOM (Grid cells visible) ===
    ax2 = plt.subplot(3, 3, 3)

    # Zoom around Fukushima
    zoom_lon_min, zoom_lon_max = 140.5, 142.5
    zoom_lat_min, zoom_lat_max = 36.5, 38.5

    # Create mask for zoom region
    zoom_mask = ((lon_2d >= zoom_lon_min) & (lon_2d <= zoom_lon_max) &
                 (lat_2d >= zoom_lat_min) & (lat_2d <= zoom_lat_max))

    if np.any(zoom_mask):
        rows, cols = np.where(zoom_mask)
        row_min, row_max = rows.min(), rows.max()
        col_min, col_max = cols.min(), cols.max()

        lon_zoom = lon_2d[row_min:row_max + 1, col_min:col_max + 1]
        lat_zoom = lat_2d[row_min:row_max + 1, col_min:col_max + 1]
        speed_zoom = speed[row_min:row_max + 1, col_min:col_max + 1]

        # Plot with grid overlay
        contour2 = ax2.contourf(lon_zoom, lat_zoom, speed_zoom,
                                levels=30, cmap='plasma', alpha=0.9)

        # Overlay grid lines (every 5th grid cell)
        for i in range(0, lon_zoom.shape[0], 5):
            ax2.plot(lon_zoom[i, :], lat_zoom[i, :],
                     'white', linewidth=0.5, alpha=0.3)
        for j in range(0, lon_zoom.shape[1], 5):
            ax2.plot(lon_zoom[:, j], lat_zoom[:, j],
                     'white', linewidth=0.5, alpha=0.3)

    # Mark points
    for cell in grid_cells:
        color = 'lime' if 'old' not in cell['label'] else 'red'
        ax2.plot(cell['target'][0], cell['target'][1],
                 color=color, marker='s', markersize=10,
                 markeredgecolor='black')
        # Add text label
        ax2.text(cell['target'][0], cell['target'][1] + 0.02,
                 cell['label'].split()[-1], fontsize=8,
                 color='white', ha='center')

    ax2.plot(FUKUSHIMA_LON, FUKUSHIMA_LAT, 'r*', markersize=12)

    ax2.set_xlabel('Longitude (°E)', fontsize=11)
    ax2.set_ylabel('Latitude (°N)', fontsize=11)
    ax2.set_title('Medium Zoom (Grid Overlay)', fontsize=13)
    ax2.grid(True, alpha=0.2)

    # === 3. HIGH-RES ZOOM (Individual grid cells) ===
    ax3 = plt.subplot(3, 3, (4, 6))

    # Extreme zoom around release points
    extreme_lon_min, extreme_lon_max = 141.0, 141.8
    extreme_lat_min, extreme_lat_max = 37.2, 37.6

    extreme_mask = ((lon_2d >= extreme_lon_min) & (lon_2d <= extreme_lon_max) &
                    (lat_2d >= extreme_lat_min) & (lat_2d <= extreme_lat_max))

    if np.any(extreme_mask):
        rows, cols = np.where(extreme_mask)
        row_min, row_max = rows.min(), rows.max()
        col_min, col_max = cols.min(), cols.max()

        lon_extreme = lon_2d[row_min:row_max + 1, col_min:col_max + 1]
        lat_extreme = lat_2d[row_min:row_max + 1, col_min:col_max + 1]
        u_extreme = u_2d[row_min:row_max + 1, col_min:col_max + 1]
        v_extreme = v_2d[row_min:row_max + 1, col_min:col_max + 1]
        speed_extreme = speed[row_min:row_max + 1, col_min:col_max + 1]

        # Plot with EXACT grid cell outlines
        im = ax3.pcolormesh(lon_extreme, lat_extreme, speed_extreme,
                            cmap='plasma', shading='auto', alpha=0.9)

        # Overlay EVERY grid cell
        n_cells_i, n_cells_j = lon_extreme.shape

        # Draw grid cell outlines
        for i in range(n_cells_i):
            for j in range(n_cells_j):
                if not np.isnan(lon_extreme[i, j]):
                    # Create rectangle for each grid cell
                    if i < n_cells_i - 1 and j < n_cells_j - 1:
                        # Get cell corners (approximate from center points)
                        lon_sw = (lon_extreme[i, j] + lon_extreme[i + 1, j]) / 2
                        lat_sw = (lat_extreme[i, j] + lat_extreme[i, j + 1]) / 2
                        lon_ne = (lon_extreme[i, j + 1] + lon_extreme[i + 1, j + 1]) / 2
                        lat_ne = (lat_extreme[i + 1, j] + lat_extreme[i + 1, j + 1]) / 2

                        rect = patches.Rectangle(
                            (lon_sw, lat_sw),
                            lon_ne - lon_sw,
                            lat_ne - lat_sw,
                            linewidth=0.3, edgecolor='white',
                            facecolor='none', alpha=0.2
                        )
                        ax3.add_patch(rect)

        # Add quiver arrows for currents
        step = max(1, min(n_cells_i, n_cells_j) // 10)
        if step > 0:
            ax3.quiver(lon_extreme[::step, ::step], lat_extreme[::step, ::step],
                       u_extreme[::step, ::step], v_extreme[::step, ::step],
                       color='white', scale=20, width=0.002,
                       headwidth=3, headlength=5)

    # Highlight exact grid cells for each coordinate
    for cell in grid_cells:
        i, j = cell['grid_cell']
        lon, lat = cell['actual_coords']

        # Draw the ACTUAL grid cell
        if not np.isnan(lon):
            # Find cell boundaries (simplified)
            cell_size = 0.04  # Approximate degrees

            if cell['label'] == 'Your old minLon':
                color = 'red'
                hatch = '////'
                alpha = 0.7
            else:
                color = 'lime'
                hatch = '....'
                alpha = 0.5

            rect = patches.Rectangle(
                (lon - cell_size / 2, lat - cell_size / 2),
                cell_size, cell_size,
                linewidth=2, edgecolor=color,
                facecolor=color, alpha=alpha,
                hatch=hatch, label=f"{cell['label']} grid cell"
            )
            ax3.add_patch(rect)

            # Add text
            ax3.text(lon, lat + 0.01, f"({i},{j})",
                     fontsize=7, ha='center', color='white',
                     bbox=dict(boxstyle='round', facecolor='black', alpha=0.5))

    ax3.set_xlabel('Longitude (°E)', fontsize=12)
    ax3.set_ylabel('Latitude (°N)', fontsize=12)
    ax3.set_title('HIGH-RESOLUTION: Individual Grid Cells\n(Each square = HYCOM grid cell)',
                  fontsize=13, fontweight='bold')
    ax3.grid(True, alpha=0.1)
    ax3.legend(loc='upper left', fontsize=9)

    # === 4. CURRENT VALUES TABLE ===
    ax4 = plt.subplot(3, 3, 7)
    ax4.axis('off')

    # Create detailed table
    table_data = []
    for cell in grid_cells:
        i, j = cell['grid_cell']
        lon, lat = cell['actual_coords']

        # Get current values at this exact grid cell
        if not np.isnan(lon):
            u_val = u_2d[i, j]
            v_val = v_2d[i, j]
            speed_val = np.sqrt(u_val ** 2 + v_val ** 2) if not np.isnan(u_val) else 0
            is_ocean = not np.isnan(u_val)
        else:
            u_val = v_val = speed_val = np.nan
            is_ocean = False

        table_data.append([
            cell['label'],
            f"{cell['target'][0]:.2f}°",
            f"{cell['target'][1]:.2f}°",
            f"({i},{j})",
            f"{lon:.4f}°",
            f"{lat:.4f}°",
            f"{cell['distance_error']:.2f} km",
            "OCEAN" if is_ocean else "LAND/COAST",
            f"{speed_val:.4f} m/s" if not np.isnan(speed_val) else "N/A",
            f"{u_val:.4f}" if not np.isnan(u_val) else "N/A",
            f"{v_val:.4f}" if not np.isnan(v_val) else "N/A"
        ])

    # Create table
    col_labels = ['Point', 'Target Lon', 'Target Lat', 'Grid (i,j)',
                  'Actual Lon', 'Actual Lat', 'Error', 'Type',
                  'Speed', 'U (E→W)', 'V (N→S)']

    table = ax4.table(cellText=table_data, colLabels=col_labels,
                      cellLoc='center', loc='center',
                      colWidths=[0.12, 0.08, 0.08, 0.07, 0.09, 0.09,
                                 0.08, 0.10, 0.08, 0.06, 0.06])

    table.auto_set_font_size(False)
    table.set_fontsize(8)
    table.scale(1.2, 1.5)

    # Color code cells
    for i, cell in enumerate(grid_cells):
        if 'old' in cell['label']:
            table[(i + 1, 0)].set_facecolor('#ffcccc')
            table[(i + 1, 7)].set_facecolor('#ff9999')
        else:
            table[(i + 1, 0)].set_facecolor('#ccffcc')
            table[(i + 1, 7)].set_facecolor('#99ff99')

    ax4.set_title('Current Values at Each Point', fontsize=12, pad=20)

    # === 5. SPEED PROFILE ALONG LON ===
    ax5 = plt.subplot(3, 3, 8)

    # Extract speed along latitude ~37.4°
    target_lat = 37.4
    lat_idx = np.argmin(np.abs(lat_2d.mean(axis=1) - target_lat))

    if lat_idx < len(lon_2d):
        lon_profile = lon_2d[lat_idx, :]
        speed_profile = speed[lat_idx, :]

        # Filter valid points
        valid = ~np.isnan(speed_profile)

        if np.any(valid):
            ax5.plot(lon_profile[valid], speed_profile[valid],
                     'b-', linewidth=2, label='Current speed')
            ax5.fill_between(lon_profile[valid], 0, speed_profile[valid],
                             alpha=0.3, color='blue')

            # Mark our points
            for cell in grid_cells:
                color = 'red' if 'old' in cell['label'] else 'green'
                ax5.axvline(cell['target'][0], color=color,
                            linestyle='--', alpha=0.7, label=cell['label'])

            ax5.set_xlabel('Longitude (°E)', fontsize=11)
            ax5.set_ylabel('Speed (m/s)', fontsize=11)
            ax5.set_title(f'Speed Profile at {target_lat}°N', fontsize=12)
            ax5.grid(True, alpha=0.3)
            ax5.legend(fontsize=8)

    # === 6. ANALYSIS TEXT ===
    ax6 = plt.subplot(3, 3, 9)
    ax6.axis('off')

    # Count ocean vs land cells in region
    region_mask = ((lon_2d >= 141.0) & (lon_2d <= 142.0) &
                   (lat_2d >= 37.0) & (lat_2d <= 38.0))

    ocean_cells = np.sum(~np.isnan(u_2d[region_mask]))
    land_cells = np.sum(np.isnan(u_2d[region_mask]))

    analysis_text = f"""
    CRITICAL FINDINGS:
    =================

    Why 141.08°E doesn't work:
    • Grid cell at 141.08° is {(grid_cells[0]['distance_error']):.1f} km from target
    • Actual coordinate: {grid_cells[0]['actual_coords'][0]:.4f}°E
    • Current speed: {np.sqrt(u_2d[grid_cells[0]['grid_cell']] ** 2 + v_2d[grid_cells[0]['grid_cell']] ** 2):.4f} m/s
    • Type: {'OCEAN' if grid_cells[0]['is_ocean'] else 'LAND/COASTAL'}

    Why 141.21°E works better:
    • Grid cell at 141.21° is {(grid_cells[1]['distance_error']):.1f} km from target
    • Actual coordinate: {grid_cells[1]['actual_coords'][0]:.4f}°E
    • Current speed: {np.sqrt(u_2d[grid_cells[1]['grid_cell']] ** 2 + v_2d[grid_cells[1]['grid_cell']] ** 2):.4f} m/s
    • Type: {'OCEAN' if grid_cells[1]['is_ocean'] else 'LAND/COASTAL'}

    Kuroshio Influence:
    • Kuroshio flows ~141.5-142.5°E near Fukushima
    • Strongest currents: 141.5-142.0°E
    • Your old box (141.08-141.21): Coastal zone
    • Your new box (141.21-141.41): Kuroshio-influenced

    Recommendations:
    1. Use 141.21-141.41°E for particle release
    2. Avoid <141.20°E (coastal/weak currents)
    3. Ideal: 141.3-141.5°E (strong Kuroshio flow)

    Statistics [141.0-142.0°E, 37.0-38.0°N]:
    • Ocean cells: {ocean_cells:,}
    • Land/coastal: {land_cells:,}
    • Ocean %: {ocean_cells / (ocean_cells + land_cells) * 100:.1f}%
    """

    ax6.text(0.02, 0.98, analysis_text, transform=ax6.transAxes,
             fontsize=9, verticalalignment='top',
             bbox=dict(boxstyle='round', facecolor='lightyellow', alpha=0.9),
             fontfamily='monospace')

    # Adjust layout
    plt.tight_layout()

    # Save figure
    output_path = f"fukushima_grid_debug_{year}_{month:02d}.png"
    plt.savefig(output_path, dpi=300, bbox_inches='tight',
                facecolor='white', edgecolor='none')
    plt.close(fig)

    print(f"\n✅ Saved debug map: {output_path}")

    return output_path


# === MAIN ===
if __name__ == "__main__":
    print("=" * 70)
    print("FUKUSHIMA GRID DEBUGGER")
    print("Shows EXACT grid cells and currents at your coordinates")
    print("=" * 70)

    try:
        # Load data
        lon_2d, lat_2d, u_2d, v_2d, year, month, n_lat, n_lon = load_first_month()

        # Find exact grid cells
        print("\nFinding exact grid cells for each coordinate:")
        grid_cells = find_grid_cells(lon_2d, lat_2d, PROBLEM_COORDS)

        # Print findings
        for cell in grid_cells:
            print(f"\n{cell['label']}:")
            print(f"  Target: ({cell['target'][0]:.2f}°E, {cell['target'][1]:.2f}°N)")
            print(f"  Grid cell: {cell['grid_cell']}")
            print(f"  Actual: ({cell['actual_coords'][0]:.4f}°E, {cell['actual_coords'][1]:.4f}°N)")
            print(f"  Error: {cell['distance_error']:.2f} km")
            print(f"  Ocean cell: {cell['is_ocean']}")

        # Create debug visualization
        output_file = create_debug_map(lon_2d, lat_2d, u_2d, v_2d, grid_cells, year, month)

        print(f"\n" + "=" * 70)
        print("ANALYSIS COMPLETE")
        print("=" * 70)
        print("\nOpen the generated PNG to see:")
        print("1. Each HYCOM grid cell outlined")
        print("2. Exact coordinates of your release points")
        print("3. Current vectors at each location")
        print("4. Speed profile across longitude")
        print("5. Detailed analysis of why 141.08°E doesn't work")

    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback

        traceback.print_exc()