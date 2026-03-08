import xarray as xr
import json
from pathlib import Path
from datetime import datetime

# Configuration
BIN_DIR = Path("data/glorys_3yr_bin/")
BASE_DATE = datetime(2011, 1, 1)

# Get depth levels from first NetCDF file (need original .nc file)
# You'll need to adjust this path to your original NetCDF files
SAMPLE_NC = Path("data/glorys_3yr_fixed/glorys_201101.nc")
ds = xr.open_dataset(SAMPLE_NC)
DEPTH_LEVELS = ds.depth.values.tolist()  # Convert numpy array to list for JSON
ds.close()

# Find all binary files
bin_files = sorted(BIN_DIR.glob("glorys_*.bin"))
print(f"Found {len(bin_files)} binary files")

days = []

for bin_file in bin_files:
    # Extract date from filename "glorys_20110311.bin"
    date_str = bin_file.stem.split('_')[1]  # "20110311"
    
    year = int(date_str[:4])
    month = int(date_str[4:6])
    day = int(date_str[6:8])
    
    # Calculate day offset from base date
    file_date = datetime(year, month, day)
    day_offset = (file_date - BASE_DATE).days
    
    days.append({
        'year': year,
        'month': month,
        'day': day,
        'date_str': f"{year}-{month:02d}-{day:02d}",
        'day_offset': day_offset,
        'file': bin_file.name
    })

# Create metadata
metadata = {
    'description': 'GLORYS daily currents at multiple depths (binary format)',
    'binary_version': 2,  # float16
    'base_date': BASE_DATE.isoformat(),
    'depths': DEPTH_LEVELS,
    'depth_count': len(DEPTH_LEVELS),
    'grid': {
        'n_lat': 781,
        'n_lon': 1921,
        'n_depth': len(DEPTH_LEVELS),
        'lon_range': [100, 260],
        'lat_range': [0, 65]
    },
    'days': days,
    'total_days': len(days),
    'date_range': {
        'start': days[0]['date_str'] if days else None,
        'end': days[-1]['date_str'] if days else None
    }
}

# Save metadata
metadata_path = BIN_DIR / "glorys_metadata.json"
with open(metadata_path, 'w') as f:
    json.dump(metadata, f, indent=2)

print(f"✅ Metadata saved to {metadata_path}")
print(f"   {len(days)} days processed")
print(f"   Depths: {DEPTH_LEVELS[:5]}... (first 5 shown)")