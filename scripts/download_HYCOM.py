#!/usr/bin/env python3
"""
HYCOM 3D Data Downloader (Corrected Time Range)
Downloads available 2011-2013 3D currents, salinity, temperature
Model: GLBa0.08/expt_90.9 (2011-01-03 to 2013-08-20)
Dataset: https://ncss.hycom.org/thredds/ncss/GLBa0.08/expt_90.9
"""

import requests
import xarray as xr
import numpy as np
from datetime import datetime, timedelta
import time
import os
from tqdm import tqdm
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class HYCOMDownloader:
    def __init__(self, output_dir="/Users/shuian/PycharmProjects/Fukushima_Plume_Simulator/data/hycom_3d/"):
        """
        Initialize downloader for available HYCOM period
        """
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)

        # HYCOM expt_90.9 available period
        self.start_date = datetime(2011, 3, 1)
        self.end_date = datetime(2012, 2, 29)

        # Spatial domain for Fukushima research
        self.bbox = {
            'north': 65.0,
            'south': 0.0,
            'west': 100.0,
            'east': 260.0
        }

        # Standard HYCOM depths (0-1000m, 40 layers)
        # Let's use key depths for Fukushima plume
        self.depths = [0.0, 50.0, 100.0,
                      200.0, 500.0,
                       1000.0]

        # Base URL for expt_90.9
        self.base_url = "https://ncss.hycom.org/thredds/ncss/GLBa0.08/expt_90.9"

        # Variables to download
        self.variables = ['u', 'v']

        # Rate limiting
        self.request_delay = 2  # seconds between requests
        self.max_retries = 3

    def build_url(self, date, depth):
        """
        Build NCSS URL for specific date and depth
        """
        year = date.year

        # Format date for URL
        date_str = date.strftime("%Y-%m-%dT%H:%M:%SZ")

        # Build variable parameters
        var_params = "&".join([f"var={v}" for v in self.variables])

        # Build URL
        url = f"{self.base_url}/{year}?{var_params}"
        url += f"&north={self.bbox['north']}"
        url += f"&south={self.bbox['south']}"
        url += f"&west={self.bbox['west']}"
        url += f"&east={self.bbox['east']}"
        url += "&disableProjSubset=on"
        url += "&horizStride=1"
        url += f"&time={date_str}"
        url += "&timeStride=1"
        url += f"&vertCoord={depth}"
        url += "&addLatLon=true"
        url += "&accept=netcdf4"

        return url

    def download_day(self, date):
        """
        Download all depths for a single day
        """
        day_dir = os.path.join(self.output_dir, date.strftime("%Y%m%d"))
        os.makedirs(day_dir, exist_ok=True)

        downloaded_files = []

        for depth in tqdm(self.depths, desc=f"Depths for {date.strftime('%Y-%m-%d')}", leave=False):
            filename = f"hycom_{date.strftime('%Y%m%d')}_depth{depth}m.nc"
            filepath = os.path.join(day_dir, filename)

            # Skip if already downloaded
            if os.path.exists(filepath):
                logger.info(f"Skipping {filename} (already exists)")
                downloaded_files.append(filepath)
                continue

            url = self.build_url(date, depth)

            for attempt in range(self.max_retries):
                try:
                    logger.info(f"Downloading {filename}...")

                    # Make request with timeout
                    response = requests.get(url, timeout=3600)
                    response.raise_for_status()

                    # Save file
                    with open(filepath, 'wb') as f:
                        f.write(response.content)

                    # Verify file
                    if os.path.getsize(filepath) > 1000:  # At least 1KB
                        logger.info(f"✓ Downloaded {filename} ({os.path.getsize(filepath) / 1e6:.1f} MB)")
                        downloaded_files.append(filepath)
                        break
                    else:
                        logger.warning(f"File too small, retrying...")
                        os.remove(filepath)
                        raise Exception("File too small")

                except Exception as e:
                    logger.error(f"Attempt {attempt + 1}/{self.max_retries} failed: {e}")
                    if attempt < self.max_retries - 1:
                        wait_time = 30 * (attempt + 1)
                        logger.info(f"Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"Failed to download {filename}")

            # Be nice to HYCOM servers
            time.sleep(self.request_delay)

        return downloaded_files

    def download_all(self):
        """
        Download all available data
        """
        total_days = (self.end_date - self.start_date).days + 1
        current_date = self.start_date

        logger.info(f"Starting download of {total_days} days")
        logger.info(f"Period: {self.start_date.date()} to {self.end_date.date()}")
        logger.info(f"Output directory: {self.output_dir}")
        logger.info(f"Estimated storage: ~{total_days * 0.054:.1f} GB")

        downloaded_count = 0
        failed_days = []

        with tqdm(total=total_days, desc="Downloading days") as pbar:
            while current_date <= self.end_date:
                try:
                    files = self.download_day(current_date)
                    if len(files) == len(self.depths):
                        downloaded_count += 1
                        logger.info(
                            f"✓ Completed day {current_date.strftime('%Y-%m-%d')} ({downloaded_count}/{total_days})")
                    else:
                        failed_days.append(current_date.strftime('%Y-%m-%d'))
                        logger.warning(f"Partial download for {current_date.strftime('%Y-%m-%d')}")

                except Exception as e:
                    logger.error(f"Failed day {current_date.strftime('%Y-%m-%d')}: {e}")
                    failed_days.append(current_date.strftime('%Y-%m-%d'))

                current_date += timedelta(days=1)
                pbar.update(1)

        # Summary
        logger.info("=" * 50)
        logger.info(f"DOWNLOAD COMPLETE")
        logger.info(f"Successfully downloaded: {downloaded_count}/{total_days} days")
        if failed_days:
            logger.warning(f"Failed days: {failed_days}")
        logger.info(f"Data saved to: {os.path.abspath(self.output_dir)}")

        # Estimate total size
        total_size = 0
        for root, dirs, files in os.walk(self.output_dir):
            for file in files:
                total_size += os.path.getsize(os.path.join(root, file))

        logger.info(f"Total storage used: {total_size / 1e9:.2f} GB")


def main():
    """Main function"""
    downloader = HYCOMDownloader()

    proceed = input("Test complete. Download all data? (y/n): ")
    if proceed.lower() == 'y':
        downloader.download_all()
    else:
        logger.info("Download cancelled")


if __name__ == "__main__":
    main()