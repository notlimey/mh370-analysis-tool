#!/usr/bin/env python3
"""Fetch ERA5 monthly-mean 10m wind for MH370 drift modeling.

Downloads from Copernicus Climate Data Store (CDS) via the cdsapi package.
Requires ~/.cdsapirc with valid API key.

Data product: ERA5 monthly averaged reanalysis on single levels
Variables:   10m u-component of wind, 10m v-component of wind
Domain:      30E-120E, 50S-10N (Indian Ocean)
Period:      March 2014 - August 2015 (18 months)
Resolution:  0.25 deg (native ERA5 grid)

Output: JSON cache file compatible with the Rust era5_wind module.

Rate limiting: CDS allows 2 concurrent requests per user. This script
makes 2 sequential requests (one per year) to avoid duplicate-month errors.

Source: Copernicus Climate Change Service (C3S), ERA5 monthly averaged data
on single levels from 1940 to present. DOI: 10.24381/cds.f17050d7
License: Copernicus License (free for research use with attribution).

Usage:
    python fetch_era5_wind.py
    python fetch_era5_wind.py --output ../src-tauri/.cache/era5_wind_monthly.json
    python fetch_era5_wind.py --check
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

AREA = [10, 30, -50, 120]  # [N, W, S, E]
CRASH_DATE = datetime(2014, 3, 8)

REQUESTS = [
    {"year": "2014", "months": ["03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]},
    {"year": "2015", "months": ["01", "02", "03", "04", "05", "06", "07", "08"]},
]


def check_cds_access():
    try:
        import cdsapi
        c = cdsapi.Client(quiet=True)
        print(f"CDS API configured: {c.url}", file=sys.stderr)
        return True
    except ImportError:
        print("ERROR: cdsapi not installed. Run: pip install cdsapi", file=sys.stderr)
        return False
    except Exception as e:
        print(f"CDS API error: {e}", file=sys.stderr)
        return False


def fetch_year(client, year: str, months: list, output_nc: str):
    """Download one year of ERA5 monthly mean wind."""
    print(f"  Requesting {year} ({len(months)} months)...", file=sys.stderr)
    client.retrieve(
        "reanalysis-era5-single-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": ["10m_u_component_of_wind", "10m_v_component_of_wind"],
            "year": [year],
            "month": months,
            "time": "00:00",
            "area": AREA,
            "format": "netcdf",
        },
        output_nc,
    )
    size_kb = os.path.getsize(output_nc) / 1024
    print(f"  Downloaded {output_nc} ({size_kb:.0f} KB)", file=sys.stderr)


def read_nc_timesteps(nc_path: str):
    """Read timesteps from a NetCDF file. Returns (lats, lons, timesteps)."""
    try:
        import netCDF4
        return _read_nc_netcdf4(nc_path)
    except ImportError:
        pass
    try:
        from scipy.io import netcdf_file
        return _read_nc_scipy(nc_path)
    except ImportError:
        pass
    print("ERROR: need netCDF4 or scipy. Run: pip install netCDF4", file=sys.stderr)
    sys.exit(1)


def _read_nc_netcdf4(nc_path: str):
    import netCDF4

    ds = netCDF4.Dataset(nc_path, "r")
    lats = ds.variables["latitude"][:].tolist()
    lons = ds.variables["longitude"][:].tolist()

    # ERA5 CDS uses "valid_time" (seconds since 1970-01-01) or "time" (hours since 1900-01-01)
    time_var_name = "valid_time" if "valid_time" in ds.variables else "time"
    time_var = ds.variables[time_var_name]
    times = netCDF4.num2date(
        time_var[:],
        time_var.units,
        getattr(time_var, "calendar", "standard"),
    )

    u10 = ds.variables["u10"][:]
    v10 = ds.variables["v10"][:]

    timesteps = []
    for t_idx, t in enumerate(times):
        dt = datetime(t.year, t.month, t.day)
        day_offset = (dt - CRASH_DATE).days
        u_flat = [round(float(x), 3) if (x == x and abs(x) < 100) else 0.0
                  for x in u10[t_idx].flatten()]
        v_flat = [round(float(x), 3) if (x == x and abs(x) < 100) else 0.0
                  for x in v10[t_idx].flatten()]
        timesteps.append({"day_offset": day_offset, "date": dt.strftime("%Y-%m-%d"),
                          "u": u_flat, "v": v_flat})

    ds.close()
    return lats, lons, timesteps


def _read_nc_scipy(nc_path: str):
    from scipy.io import netcdf_file

    ds = netcdf_file(nc_path, "r", mmap=False)
    lats = ds.variables["latitude"].data.tolist()
    lons = ds.variables["longitude"].data.tolist()

    if "valid_time" in ds.variables:
        # seconds since 1970-01-01
        base = datetime(1970, 1, 1)
        times = [base + timedelta(seconds=float(s)) for s in ds.variables["valid_time"].data]
    else:
        base = datetime(1900, 1, 1)
        times = [base + timedelta(hours=float(h)) for h in ds.variables["time"].data]

    u10 = ds.variables["u10"].data.copy()
    v10 = ds.variables["v10"].data.copy()
    for vname, arr in [("u10", u10), ("v10", v10)]:
        v = ds.variables[vname]
        if hasattr(v, "scale_factor"):
            arr[:] = arr * v.scale_factor
        if hasattr(v, "add_offset"):
            arr[:] = arr + v.add_offset

    timesteps = []
    for t_idx, t in enumerate(times):
        day_offset = (t - CRASH_DATE).days
        u_flat = [round(float(x), 3) if (x == x and abs(x) < 100) else 0.0
                  for x in u10[t_idx].flatten()]
        v_flat = [round(float(x), 3) if (x == x and abs(x) < 100) else 0.0
                  for x in v10[t_idx].flatten()]
        timesteps.append({"day_offset": day_offset, "date": t.strftime("%Y-%m-%d"),
                          "u": u_flat, "v": v_flat})

    ds.close()
    return lats, lons, timesteps


def main():
    parser = argparse.ArgumentParser(description="Fetch ERA5 monthly mean 10m wind")
    parser.add_argument("--output", "-o", type=Path,
                        default=Path(__file__).parent.parent / "src-tauri" / ".cache" / "era5_wind_monthly.json")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--keep-nc", action="store_true", help="Keep NetCDF files")
    args = parser.parse_args()

    if args.check:
        sys.exit(0 if check_cds_access() else 1)
    if not check_cds_access():
        sys.exit(1)

    import cdsapi
    client = cdsapi.Client()

    args.output.parent.mkdir(parents=True, exist_ok=True)

    # Download each year separately (CDS rejects duplicate months in a single request)
    nc_files = []
    all_timesteps = []
    lats = lons = None

    print(f"Fetching ERA5 monthly wind for Indian Ocean...", file=sys.stderr)
    for req in REQUESTS:
        nc_path = str(args.output.with_suffix("")) + f"_{req['year']}.nc"
        fetch_year(client, req["year"], req["months"], nc_path)
        nc_files.append(nc_path)

        file_lats, file_lons, timesteps = read_nc_timesteps(nc_path)
        if lats is None:
            lats, lons = file_lats, file_lons
        all_timesteps.extend(timesteps)

    # Sort by day offset
    all_timesteps.sort(key=lambda t: t["day_offset"])

    # Build JSON cache
    cache = {
        "version": 1,
        "source": "ERA5 monthly averaged reanalysis on single levels",
        "doi": "10.24381/cds.f17050d7",
        "license": "Copernicus License",
        "variables": "10m u/v wind components (m/s)",
        "domain": f"{min(lons):.1f}E-{max(lons):.1f}E, {min(lats):.1f}N-{max(lats):.1f}N",
        "period": f"{all_timesteps[0]['date']} to {all_timesteps[-1]['date']}",
        "resolution_deg": round(abs(lats[1] - lats[0]), 4) if len(lats) > 1 else 0.25,
        "lats": [round(x, 4) for x in lats],
        "lons": [round(x, 4) for x in lons],
        "timesteps": all_timesteps,
    }

    with open(args.output, "w") as f:
        json.dump(cache, f, separators=(",", ":"))

    size_mb = args.output.stat().st_size / 1_048_576
    print(f"\nCache: {args.output} ({size_mb:.1f} MB)", file=sys.stderr)
    print(f"  {len(lats)} lats x {len(lons)} lons x {len(all_timesteps)} months", file=sys.stderr)
    print(f"  Lat: {min(lats):.2f} to {max(lats):.2f}", file=sys.stderr)
    print(f"  Lon: {min(lons):.2f} to {max(lons):.2f}", file=sys.stderr)
    print(f"  Day offsets: {all_timesteps[0]['day_offset']} to {all_timesteps[-1]['day_offset']}", file=sys.stderr)

    # Clean up NetCDF files
    if not args.keep_nc:
        for nc in nc_files:
            try:
                os.remove(nc)
            except OSError:
                pass

    print(f"\nDone. Rust era5_wind module will load this on first use.", file=sys.stderr)


if __name__ == "__main__":
    main()
