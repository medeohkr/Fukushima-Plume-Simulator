import xarray as xr
import numpy as np
import struct
from pathlib import Path

# Configuration
input_dir = Path("D:/PROTEUS/data/glorys_3yr_fixed")
output_dir = Path("D:/PROTEUS/data/glorys_3yr_bin")
output_dir.mkdir(exist_ok=True)

# Find all monthly NetCDF files
nc_files = sorted(input_dir.glob("glorys_*.nc"))
print(f"Found {len(nc_files)} monthly files to process")

# Loop through each file
for nc_file in nc_files:
    print(f"\n{'='*50}")
    print(f"Processing: {nc_file.name}")
    
    # Open dataset
    ds = xr.open_dataset(nc_file)
    
    # Get expected month from filename
    expected_year = int(nc_file.stem.split('_')[1][:4])
    expected_month = int(nc_file.stem.split('_')[1][4:6])
    
    print(f"  Expected: {expected_year}-{expected_month:02d}")
    print(f"  Actual dates: {ds.time.values[0]} to {ds.time.values[-1]}")
    print(f"  Days in file: {len(ds.time)}")
    
    # Get coordinates (same for all days)
    lons = ds.longitude.values
    lats = ds.latitude.values
    depths = ds.depth.values
    lon_2d, lat_2d = np.meshgrid(lons, lats)
    
    days_processed = 0
    days_skipped = 0
    
    # Loop through each day
    for day_idx in range(len(ds.time)):
        day = ds.time.isel(time=day_idx).values
        
        # Convert numpy datetime64 to string for filename
        day_str = str(day)[:10].replace('-', '')
        
        day_year = int(day_str[:4])
        day_month = int(day_str[4:6])
        if day_year != expected_year or day_month != expected_month:
            days_skipped += 1
            continue
        
        # Extract data for this day
        u_daily = ds.uo.isel(time=day_idx).values.astype('float16')
        v_daily = ds.vo.isel(time=day_idx).values.astype('float16')
        mlotst_daily = ds.mlotst.isel(time=day_idx).values.astype('float16')
        
        # Replace NaN with 0
        u_daily = np.where(np.isnan(u_daily), 0, u_daily)
        v_daily = np.where(np.isnan(v_daily), 0, v_daily)
        mlotst_daily = np.where(np.isnan(mlotst_daily), 0, mlotst_daily)
        
        # Get dimensions
        n_depth, n_lat, n_lon = u_daily.shape
        
        # Write daily file
        output_file = output_dir / f"glorys_{day_str}.bin"
        
        # Skip if already exists (optional)
        if output_file.exists():
            print(f"  ⏭️  {day_str} already exists, skipping")
            days_skipped += 1
            continue
        
        with open(output_file, 'wb') as f:
            # Header
            year = int(day_str[:4])
            month = int(day_str[4:6])
            day_num = int(day_str[6:8])
            header = struct.pack('7i', 2, n_lat, n_lon, n_depth, year, month, day_num)
            f.write(header)
            
            # Coordinates
            f.write(lon_2d.astype('float32').tobytes())
            f.write(lat_2d.astype('float32').tobytes())
            
            # Data
            f.write(u_daily.tobytes())
            f.write(v_daily.tobytes())
            f.write(mlotst_daily.tobytes())
        
        print(f"  ✅ Saved: glorys_{day_str}.bin")
        days_processed += 1
    
    print(f"  📊 Summary: {days_processed} processed, {days_skipped} skipped")
    ds.close()

print("\n" + "="*50)
print("🎉 All files processed successfully!")