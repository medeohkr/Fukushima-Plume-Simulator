import copernicusmarine
from datetime import datetime, timedelta

copernicusmarine.login()

DATE_TIME_START = datetime(2011, 1, 1)
DATE_TIME_END = datetime(2013, 12, 31)

current_date = DATE_TIME_START
while current_date <= DATE_TIME_END:
    if current_date.month == 12:
        end_date = datetime(current_date.year + 1, 1, 1)
        next_date = datetime(current_date.year + 1, 1, 1)
    else:
        end_date = datetime(current_date.year, current_date.month + 1, 1)
        next_date = datetime(current_date.year, current_date.month + 1, 1)
    
    # Format with 'T'!
    start_str = current_date.strftime("%Y-%m-%dT%H:%M:%S")
    end_str = end_date.strftime("%Y-%m-%dT%H:%M:%S")
    
    print(f"Downloading: {start_str} to {end_str}")
    
    copernicusmarine.subset(
        dataset_id="cmems_mod_glo_phy_my_0.083deg_P1D-m",
        variables=["vo", "mlotst", "uo"],
        minimum_longitude=100,
        maximum_longitude=260,
        minimum_latitude=0,
        maximum_latitude=65,
        start_datetime=start_str,  # Now with 'T'!
        end_datetime=end_str,      # Now with 'T'!
        minimum_depth=0.49402499198913574,
        maximum_depth=541.0889282226562,
        output_directory="glorys_3yr_fixed",
        output_filename=f"glorys_{current_date.strftime('%Y%m')}.nc"
    )

    print(f"Saved: glorys_{current_date.strftime('%Y%m')}.nc")
    current_date = next_date

print("All downloads finished successfully!")