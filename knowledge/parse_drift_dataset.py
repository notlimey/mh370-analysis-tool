#!/usr/bin/env python3
"""Parse drift dataset v2 binary (outcome labels only) to numpy npz.

Binary format "MH370DL2":
  Header:
    magic: 8 bytes
    version: u8
    n_origins: u32
    n_particles_per_origin: u32
    max_days: u32
    seed_lat_min/max, seed_lon_min/max: f32 x4
    created_timestamp: u64

  Per particle record:
    origin_idx: u16
    particle_idx: u16
    n_outcomes: u8
    outcomes: [(site_id: u8, arrival_day: u16, timing_match: u8)] x n_outcomes

Usage:
    python parse_drift_dataset.py datasets/drift_dataset_v2.bin
    python parse_drift_dataset.py datasets/drift_dataset_v2.bin -o out.npz
"""

import argparse
import struct
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy not installed. Run: pip install numpy", file=sys.stderr)
    sys.exit(1)

SITE_NAMES = [
    "Reunion", "Mozambique_flap", "Mozambique_panel", "Tanzania_Pemba",
    "Rodrigues", "Mauritius", "Mossel_Bay_SA", "Madagascar",
]
N_SITES = 8


def parse_header(f):
    magic = f.read(8)
    if magic != b"MH370DL2":
        raise ValueError(f"Bad magic: {magic!r}, expected b'MH370DL2'")
    version = struct.unpack("<B", f.read(1))[0]
    n_origins, n_particles, max_days = struct.unpack("<III", f.read(12))
    lat_min, lat_max, lon_min, lon_max = struct.unpack("<ffff", f.read(16))
    timestamp = struct.unpack("<Q", f.read(8))[0]
    return {
        "version": version,
        "n_origins": n_origins,
        "n_particles": n_particles,
        "max_days": max_days,
        "lat_range": (lat_min, lat_max),
        "lon_range": (lon_min, lon_max),
        "timestamp": timestamp,
    }


def parse_records(f, header):
    n_total = header["n_origins"] * header["n_particles"]
    start_lats = []
    start_lons = []
    origin_idxs = []
    any_hit = []
    timed_hit = []
    arrival_day = []

    # Track origin lat/lon from first particle of each origin
    origin_lats = {}
    origin_lons = {}

    count = 0
    while True:
        rec = f.read(5)  # origin_idx(2) + particle_idx(2) + n_outcomes(1)
        if len(rec) < 5:
            break

        oidx, pidx, n_out = struct.unpack("<HHB", rec)

        # Read start position from origin grid (we don't store per-particle start,
        # but all particles in an origin share the same start)
        # We'll reconstruct from the origin index.
        origin_idxs.append(oidx)

        row_any = [False] * N_SITES
        row_timed = [False] * N_SITES
        row_day = [-1] * N_SITES

        for _ in range(n_out):
            site_id, arr_day, tmatch = struct.unpack("<BHB", f.read(4))
            if site_id < N_SITES:
                row_any[site_id] = True
                row_timed[site_id] = bool(tmatch)
                row_day[site_id] = arr_day

        any_hit.append(row_any)
        timed_hit.append(row_timed)
        arrival_day.append(row_day)
        count += 1

    print(f"Read {count} particle records (expected {n_total})", file=sys.stderr)

    return {
        "origin_idx": np.array(origin_idxs, dtype=np.int32),
        "any_hit": np.array(any_hit, dtype=bool),
        "timed_hit": np.array(timed_hit, dtype=bool),
        "arrival_day": np.array(arrival_day, dtype=np.int16),
        "n_records": count,
    }


def print_summary(header, data):
    n_origins = header["n_origins"]
    n_particles = header["n_particles"]
    origin_idx = data["origin_idx"]
    any_hit = data["any_hit"]
    timed_hit = data["timed_hit"]

    print(f"\n{'='*60}", file=sys.stderr)
    print("Per-site summary:", file=sys.stderr)
    print(f"{'Site':<20} {'Any hits':>10} {'Timed hits':>12} {'Any rate':>10} {'Timed rate':>12}",
          file=sys.stderr)
    print("-" * 64, file=sys.stderr)

    total = data["n_records"]
    for i, name in enumerate(SITE_NAMES):
        n_any = any_hit[:, i].sum()
        n_timed = timed_hit[:, i].sum()
        print(
            f"{name:<20} {n_any:>10} {n_timed:>12} {n_any/total*100:>9.2f}% {n_timed/total*100:>11.2f}%",
            file=sys.stderr,
        )

    # Best origin per site (by timed hit rate)
    print(f"\nBest origin per site (by timed hit rate):", file=sys.stderr)
    unique_origins = sorted(set(origin_idx))
    for i, name in enumerate(SITE_NAMES):
        best_rate = 0
        best_oidx = -1
        for oidx in unique_origins:
            mask = origin_idx == oidx
            n = mask.sum()
            if n == 0:
                continue
            rate = timed_hit[mask, i].sum() / n
            if rate > best_rate:
                best_rate = rate
                best_oidx = oidx
        if best_oidx >= 0:
            print(f"  {name}: origin {best_oidx} ({best_rate*100:.1f}% timed hit rate)", file=sys.stderr)
        else:
            print(f"  {name}: no timed hits from any origin", file=sys.stderr)

    print(f"{'='*60}\n", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Parse drift dataset v2 to numpy npz")
    parser.add_argument("input", type=Path, help="Input .bin file")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Output .npz file")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"ERROR: {args.input} not found", file=sys.stderr)
        sys.exit(1)

    output = args.output or args.input.with_suffix(".npz")

    with open(args.input, "rb") as f:
        header = parse_header(f)
        print(f"Header: {header}", file=sys.stderr)
        data = parse_records(f, header)

    print_summary(header, data)

    np.savez_compressed(
        output,
        origin_idx=data["origin_idx"],
        any_hit=data["any_hit"],
        timed_hit=data["timed_hit"],
        arrival_day=data["arrival_day"],
        n_origins=header["n_origins"],
        n_particles_per_origin=header["n_particles"],
        max_days=header["max_days"],
        site_names=np.array(SITE_NAMES),
    )

    size_mb = output.stat().st_size / 1_048_576
    print(f"Saved {output} ({size_mb:.1f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
