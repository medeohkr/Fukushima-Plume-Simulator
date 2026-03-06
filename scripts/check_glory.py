# check_glorys.py
import xarray as xr
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path

# ============================================
# CONFIGURATION
# ============================================
data_dir = Path("D:/PROTEUS/data/test")
fukushima_lat = 37.42
fukushima_lon = 142.03

# ============================================
# FIND THE FILE
# ============================================
nc_files = list(data_dir.glob("*.nc"))
if not nc_files:
    print(f"❌ No NetCDF files found in {data_dir}")
    exit(1)

file_path = nc_files[0]
print(f"📂 Checking file: {file_path.name}")
print(f"   Size: {file_path.stat().st_size / 1e6:.2f} MB")
print("=" * 60)

# ============================================
# OPEN DATASET
# ============================================
ds = xr.open_dataset(file_path)

# ============================================
# BASIC INFO
# ============================================
print("\n📊 DATASET OVERVIEW:")
print(f"   Dimensions: {dict(ds.dims)}")
print(f"   Variables: {list(ds.data_vars.keys())}")
print(f"   Coordinates: {list(ds.coords.keys())}")
print()

# ============================================
# CHECK COORDINATES
# ============================================
print("📍 COORDINATES:")
print(f"   Longitude range: {ds.longitude.values.min():.2f} to {ds.longitude.values.max():.2f}")
print(f"   Latitude range: {ds.latitude.values.min():.2f} to {ds.latitude.values.max():.2f}")
print(f"   Depth levels: {ds.depth.values} m")
print(f"   Time: {ds.time.values}")

# ============================================
# CHECK FUKUSHIMA POINT
# ============================================
print("\n🎯 FUKUSHIMA RELEASE POINT (37.42°N, 142.03°E):")

# Find nearest grid indices
lat_idx = np.argmin(np.abs(ds.latitude.values - fukushima_lat))
lon_idx = np.argmin(np.abs(ds.longitude.values - fukushima_lon))

actual_lat = ds.latitude.values[lat_idx]
actual_lon = ds.longitude.values[lon_idx]
lat_dist = np.abs(actual_lat - fukushima_lat) * 111  # km per degree
lon_dist = np.abs(actual_lon - fukushima_lon) * 111 * np.cos(np.radians(actual_lat))
total_dist = np.sqrt(lat_dist**2 + lon_dist**2)

print(f"   Nearest grid point: {actual_lat:.4f}°N, {actual_lon:.4f}°E")
print(f"   Distance from actual: {total_dist:.1f} km")

# Get velocities at this point
if 'uo' in ds and 'vo' in ds:
    u = ds.uo.isel(time=0, depth=0, latitude=lat_idx, longitude=lon_idx).values
    v = ds.vo.isel(time=0, depth=0, latitude=lat_idx, longitude=lon_idx).values
    speed = np.sqrt(u**2 + v**2)
    
    print(f"\n🌊 VELOCITIES at surface:")
    print(f"   u (east-west): {u:.4f} m/s ({'eastward' if u>0 else 'westward'})")
    print(f"   v (north-south): {v:.4f} m/s ({'northward' if v>0 else 'southward'})")
    print(f"   speed: {speed:.4f} m/s")
    
    # Check if reasonable (ocean currents are typically 0.1-1.0 m/s)
    if 0.01 < speed < 2.0:
        print("   ✅ Speed is within reasonable range (0.01-2.0 m/s)")
    else:
        print("   ⚠️ Speed seems unusual - check data")

# ============================================
# BASIC STATISTICS
# ============================================
print("\n📈 BASIC STATISTICS (entire domain):")
for var in ['uo', 'vo']:
    if var in ds:
        data = ds[var].values
        print(f"   {var}:")
        print(f"      min: {data.min():.4f} m/s")
        print(f"      max: {data.max():.4f} m/s")
        print(f"      mean: {data.mean():.4f} m/s")
        print(f"      std: {data.std():.4f} m/s")

# ============================================
# QUICK VISUALIZATION
# ============================================
try:
    print("\n🖼️  Creating quick visualization...")
    
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # Plot u velocity
    im1 = axes[0].pcolormesh(ds.longitude, ds.latitude, 
                             ds.uo.isel(time=0, depth=0),
                             cmap='RdBu', shading='auto')
    axes[0].set_title('U velocity (east-west) - March 11, 2011')
    axes[0].set_xlabel('Longitude')
    axes[0].set_ylabel('Latitude')
    plt.colorbar(im1, ax=axes[0], label='m/s')
    
    # Mark Fukushima
    axes[0].plot(fukushima_lon, fukushima_lat, 'r*', markersize=15, 
                markeredgecolor='white', markeredgewidth=1, label='Fukushima')
    
    # Plot v velocity
    im2 = axes[1].pcolormesh(ds.longitude, ds.latitude,
                             ds.vo.isel(time=0, depth=0),
                             cmap='RdBu', shading='auto')
    axes[1].set_title('V velocity (north-south) - March 11, 2011')
    axes[1].set_xlabel('Longitude')
    axes[1].set_ylabel('Latitude')
    plt.colorbar(im2, ax=axes[1], label='m/s')
    
    # Mark Fukushima
    axes[1].plot(fukushima_lon, fukushima_lat, 'r*', markersize=15,
                markeredgecolor='white', markeredgewidth=1)
    
    plt.tight_layout()
    plt.savefig('glorys_test_check.png', dpi=150, bbox_inches='tight')
    print("✅ Saved plot to glorys_test_check.png")
    
    # Show plot if running interactively
    plt.show()
    
except Exception as e:
    print(f"⚠️  Could not create plot: {e}")

# ============================================
# CHECK FOR WO (if downloaded)
# ============================================
if 'wo' in ds:
    print("\n⬆️ VERTICAL VELOCITY (wo) present:")
    wo_data = ds.wo.isel(time=0, depth=0).values
    print(f"   min: {wo_data.min():.6f} m/s")
    print(f"   max: {wo_data.max():.6f} m/s")
    print(f"   mean: {wo_data.mean():.6f} m/s")
    # Vertical velocity should be much smaller than horizontal
    if np.abs(wo_data.mean()) < 0.001:
        print("   ✅ Vertical velocity magnitude is reasonable (< 0.001 m/s)")
    else:
        print("   ⚠️ Vertical velocity seems large - check")

# ============================================
# SUMMARY
# ============================================
print("\n" + "=" * 60)
print("✅ CHECK COMPLETE")
print("=" * 60)

# Close dataset
ds.close()