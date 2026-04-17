#!/usr/bin/env python3
"""
Extract sonar scan coverage polygons from AusSeabed WMS server.

Fetches GetMap images for MH370 search area sonar layers, extracts non-transparent
regions as polygons, simplifies them, and saves as GeoJSON files.

Data source: AusSeabed / Geoscience Australia
License: CC BY 4.0
Attribution: Governments of Australia, Malaysia and PRC, 2018

Usage:
    python3 scripts/extract_sonar_coverage.py

Output:
    public/data/sonar_coverage/*.geojson
"""

import json
import os
import sys
from datetime import date
from io import BytesIO
from pathlib import Path

import geojson
import numpy as np
import requests
from PIL import Image
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from skimage.measure import find_contours

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WMS_BASE = "https://warehouse.ausseabed.gov.au/geoserver/wms"

LAYERS = {
    "auv": {
        "wms_layer": "ausseabed:MH370_Phase_2_Sonar_Imagery_Backscatter_Inverse_Autonomous_Underwater_Vehicle__SSS__5m_2018",
        "instrument": "AUV Side Scan Sonar",
        "resolution": "5m",
        "phase": "Phase 2",
    },
    "deeptow": {
        "wms_layer": "ausseabed:MH370_Phase_2_Sonar_Imagery_Backscatter_Inverse_Deep_Tow__SSS__5m_2018",
        "instrument": "Deep Tow Side Scan Sonar",
        "resolution": "5m",
        "phase": "Phase 2",
    },
    "gophoenix": {
        # Note: No dedicated Go Phoenix layer exists on AusSeabed WMS.
        # The DHJ (Dong Hai Jiu) SAS wide backscatter layer covers the
        # Go Phoenix / Dong Hai Jiu 101 survey vessel's SAS data.
        "wms_layer": "ausseabed:MH370_Phase_2_Sonar_Imagery_Backscatter_Wide_DHJ__SAS__5m_2018",
        "instrument": "Go Phoenix / Dong Hai Jiu Synthetic Aperture Sonar",
        "resolution": "5m",
        "phase": "Phase 2",
    },
    "bathymetry": {
        "wms_layer": "ausseabed:Southern_Indian_Ocean__MH370__Bathymetry__150m_2017",
        "instrument": "Bathymetry 150m",
        "resolution": "150m",
        "phase": "Phase 1",
    },
}

# Bounding box: 85E to 100E, 42S to 20S
BBOX_LON_MIN = 85.0
BBOX_LON_MAX = 100.0
BBOX_LAT_MIN = -42.0
BBOX_LAT_MAX = -20.0

IMG_WIDTH = 1500
IMG_HEIGHT = 2200

SIMPLIFY_TOLERANCE = 0.02  # ~2 km in degrees
BATHYMETRY_SIMPLIFY_TOLERANCE = 0.03  # more aggressive for bathymetry
MIN_CONTOUR_AREA_PX = 50

EXTRACTED_DATE = "2026-04-08"
ATTRIBUTION = "Governments of Australia, Malaysia and PRC, 2018. CC BY 4.0"

# Project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "public" / "data" / "sonar_coverage"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def pixel_to_lonlat(col, row, width, height, bbox):
    """Convert pixel coordinates to lon/lat. (0,0) is top-left."""
    lon_min, lat_min, lon_max, lat_max = bbox
    lon = lon_min + (col / width) * (lon_max - lon_min)
    lat = lat_max - (row / height) * (lat_max - lat_min)  # y-axis inverted
    return lon, lat


def fetch_wms_image(layer_name, bbox_str, width, height):
    """Fetch a WMS GetMap image. Returns PIL Image or None."""
    params = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetMap",
        "LAYERS": layer_name,
        "BBOX": bbox_str,
        "WIDTH": width,
        "HEIGHT": height,
        "SRS": "EPSG:4326",
        "FORMAT": "image/png",
        "TRANSPARENT": "true",
    }
    print(f"  Fetching WMS: BBOX={bbox_str}, {width}x{height} ...")
    resp = requests.get(WMS_BASE, params=params, timeout=120)
    resp.raise_for_status()

    content_type = resp.headers.get("Content-Type", "")
    if "xml" in content_type or "html" in content_type:
        print(f"  WARNING: Got non-image response: {content_type}")
        print(f"  Body: {resp.text[:500]}")
        return None

    img = Image.open(BytesIO(resp.content))
    return img


def fetch_layer_image(layer_name):
    """Try both BBOX orderings for WMS 1.1.1 and return the one with data."""
    # WMS 1.1.1 with EPSG:4326: try lon,lat (x,y) ordering first
    bbox_lonlat = f"{BBOX_LON_MIN},{BBOX_LAT_MIN},{BBOX_LON_MAX},{BBOX_LAT_MAX}"
    # Alternative: lat,lon ordering
    bbox_latlon = f"{BBOX_LAT_MIN},{BBOX_LON_MIN},{BBOX_LAT_MAX},{BBOX_LON_MAX}"

    for label, bbox_str in [("lon,lat", bbox_lonlat), ("lat,lon", bbox_latlon)]:
        print(f"  Trying BBOX ordering: {label}")
        try:
            img = fetch_wms_image(layer_name, bbox_str, IMG_WIDTH, IMG_HEIGHT)
            if img is None:
                continue
            arr = np.array(img)
            # Check if image has any non-transparent pixels
            if arr.ndim >= 3 and arr.shape[2] == 4:
                alpha = arr[:, :, 3]
            elif arr.ndim >= 3 and arr.shape[2] == 3:
                # No alpha channel — check if all white/black
                gray = np.mean(arr[:, :, :3], axis=2)
                alpha = np.where(gray > 5, 255, 0).astype(np.uint8)
            else:
                alpha = np.where(arr > 0, 255, 0).astype(np.uint8)

            nonzero = np.count_nonzero(alpha)
            total = alpha.size
            pct = 100.0 * nonzero / total
            print(f"    Non-transparent pixels: {nonzero}/{total} ({pct:.2f}%)")

            if nonzero > 100:
                print(f"    Using {label} ordering.")
                return img, bbox_str
            else:
                print(f"    Image appears empty with {label} ordering.")
        except Exception as e:
            print(f"    Error with {label}: {e}")

    return None, None


def image_to_mask(img):
    """Convert RGBA/RGB image to binary mask (1 = data, 0 = no data)."""
    arr = np.array(img)
    if arr.ndim >= 3 and arr.shape[2] == 4:
        mask = (arr[:, :, 3] > 0).astype(np.uint8)
    elif arr.ndim >= 3 and arr.shape[2] == 3:
        gray = np.mean(arr[:, :, :3], axis=2)
        mask = (gray > 5).astype(np.uint8)
    else:
        mask = (arr > 0).astype(np.uint8)
    return mask


def cleanup_mask(mask, dilate_px=1):
    """Morphological close: dilate then erode to fill single-pixel gaps only."""
    if dilate_px == 0:
        return mask
    struct = ndimage.generate_binary_structure(2, 1)
    dilated = ndimage.binary_dilation(mask, structure=struct, iterations=dilate_px)
    cleaned = ndimage.binary_erosion(dilated, structure=struct, iterations=dilate_px)
    return cleaned.astype(np.uint8)


def contour_area_pixels(contour):
    """Approximate area of a contour in pixels using the shoelace formula."""
    n = len(contour)
    if n < 3:
        return 0
    x = contour[:, 1]
    y = contour[:, 0]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def contours_to_polygons(mask, bbox, simplify_tol):
    """Extract contours from mask, convert to lon/lat polygons."""
    lon_min, lat_min, lon_max, lat_max = bbox
    height, width = mask.shape

    contours = find_contours(mask, level=0.5)
    print(f"    Found {len(contours)} raw contours")

    polygons = []
    for contour in contours:
        area = contour_area_pixels(contour)
        if area < MIN_CONTOUR_AREA_PX:
            continue

        # Convert pixel coords (row, col) to (lon, lat)
        coords = []
        for row, col in contour:
            lon = lon_min + (col / width) * (lon_max - lon_min)
            lat = lat_max - (row / height) * (lat_max - lat_min)
            coords.append((lon, lat))

        # Close the ring
        if coords[0] != coords[-1]:
            coords.append(coords[0])

        try:
            poly = Polygon(coords)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            simplified = poly.simplify(simplify_tol, preserve_topology=True)
            if simplified.is_empty:
                continue
            polygons.append(simplified)
        except Exception as e:
            print(f"    Skipping invalid polygon: {e}")

    print(f"    Kept {len(polygons)} polygons after filtering")
    return polygons


def parse_bbox_str(bbox_str):
    """Parse 'a,b,c,d' to (lon_min, lat_min, lon_max, lat_max)."""
    parts = [float(x) for x in bbox_str.split(",")]
    # Determine ordering: if first value > 0 it's likely longitude
    # We know our bbox: lons are 85-100, lats are -42 to -20
    if parts[0] > 0:
        # lon,lat ordering: lon_min, lat_min, lon_max, lat_max
        return parts[0], parts[1], parts[2], parts[3]
    else:
        # lat,lon ordering: lat_min, lon_min, lat_max, lon_max
        return parts[1], parts[0], parts[3], parts[2]


def make_feature(geom, layer_id, layer_info):
    """Create a GeoJSON Feature from a Shapely geometry."""
    return geojson.Feature(
        geometry=mapping(geom),
        properties={
            "source": layer_id,
            "instrument": layer_info["instrument"],
            "resolution": layer_info["resolution"],
            "phase": layer_info["phase"],
            "source_wms": layer_info["wms_layer"],
            "extracted_date": EXTRACTED_DATE,
            "attribution": ATTRIBUTION,
        },
    )


def save_geojson(features, filepath):
    """Save a list of GeoJSON features to a file."""
    fc = geojson.FeatureCollection(features)
    with open(filepath, "w") as f:
        json.dump(fc, f, indent=2)
    print(f"  Saved {filepath} ({len(features)} features)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def process_layer(layer_id, layer_info):
    """Process a single WMS layer and return list of GeoJSON features."""
    print(f"\n{'='*60}")
    print(f"Processing: {layer_id} ({layer_info['instrument']})")
    print(f"  WMS layer: {layer_info['wms_layer']}")

    img, bbox_str = fetch_layer_image(layer_info["wms_layer"])
    if img is None:
        print(f"  FAILED: Could not fetch image for {layer_id}")
        return []

    bbox = parse_bbox_str(bbox_str)
    print(f"  Parsed BBOX (lon_min, lat_min, lon_max, lat_max): {bbox}")

    mask = image_to_mask(img)
    print(f"  Mask shape: {mask.shape}, non-zero: {np.count_nonzero(mask)}")

    cleaned = cleanup_mask(mask, dilate_px=1)
    print(f"  Cleaned mask non-zero: {np.count_nonzero(cleaned)}")

    tol = BATHYMETRY_SIMPLIFY_TOLERANCE if layer_id == "bathymetry" else SIMPLIFY_TOLERANCE
    polygons = contours_to_polygons(cleaned, bbox, tol)

    features = []
    for poly in polygons:
        # Handle both Polygon and MultiPolygon from simplification
        if isinstance(poly, MultiPolygon):
            for p in poly.geoms:
                features.append(make_feature(p, layer_id, layer_info))
        else:
            features.append(make_feature(poly, layer_id, layer_info))

    return features


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_features = []
    all_geometries = []

    for layer_id, layer_info in LAYERS.items():
        features = process_layer(layer_id, layer_info)

        if features:
            outpath = OUTPUT_DIR / f"{layer_id}_coverage.geojson"
            save_geojson(features, outpath)

            all_features.extend(features)
            for f in features:
                geom = shape(f["geometry"])
                if not geom.is_empty:
                    all_geometries.append(geom)

    # Create combined file
    print(f"\n{'='*60}")
    print("Creating combined coverage file...")

    if all_geometries:
        combined_geom = unary_union(all_geometries)
        if not combined_geom.is_empty:
            combined_feature = geojson.Feature(
                geometry=mapping(combined_geom),
                properties={
                    "source": "all",
                    "description": "Combined MH370 sonar search coverage",
                    "extracted_date": EXTRACTED_DATE,
                    "attribution": ATTRIBUTION,
                },
            )
            save_geojson([combined_feature], OUTPUT_DIR / "all_coverage.geojson")
    else:
        print("  No geometries to combine.")

    print(f"\nDone. Output in: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
