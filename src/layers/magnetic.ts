import { fromUrl } from "geotiff";
import type { Map as MapboxMap } from "mapbox-gl";
import mapboxgl from "mapbox-gl";
import emagTiffUrl from "../data/emag2_mh370.tiff";

const WEST = 76;
const EAST = 116;
const SOUTH = -44;
const NORTH = -8;

let hoverPopup: mapboxgl.Popup | null = null;
let hoverBound = false;
let rasterState: {
  width: number;
  height: number;
  values: Float32Array | Float64Array | Int16Array | Int32Array | Uint16Array | Uint8Array;
  noData: number | null;
} | null = null;

export async function loadMagneticLayer(map: MapboxMap): Promise<void> {
  const image = await renderMagneticOverlay();

  map.addSource("magnetic-source", {
    type: "image",
    url: image,
    coordinates: [
      [WEST, NORTH],
      [EAST, NORTH],
      [EAST, SOUTH],
      [WEST, SOUTH],
    ],
  });

  map.addLayer({
    id: "magnetic-raster",
    type: "raster",
    source: "magnetic-source",
    paint: {
      "raster-opacity": 0.4,
      "raster-resampling": "linear",
    },
  });

  bindMagneticHover(map);
}

async function renderMagneticOverlay(): Promise<string> {
  const tiff = await fromUrl(emagTiffUrl);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const values = (await image.readRasters({ interleave: true })) as Float32Array;
  const noDataValue = image.getGDALNoData();
  const noData = noDataValue === null ? null : Number(noDataValue);

  rasterState = { width, height, values, noData };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value) || (noData !== null && value === noData)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Failed to get canvas context for magnetic overlay");
  }

  const imageData = context.createImageData(width, height);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const pixel = i * 4;
    if (!Number.isFinite(value) || (noData !== null && value === noData)) {
      imageData.data[pixel + 3] = 0;
      continue;
    }

    const normalized = max > min ? (value - min) / (max - min) : 0.5;
    const [r, g, b] = colorRamp(normalized);
    imageData.data[pixel] = r;
    imageData.data[pixel + 1] = g;
    imageData.data[pixel + 2] = b;
    imageData.data[pixel + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

function bindMagneticHover(map: MapboxMap): void {
  if (hoverBound) return;
  hoverBound = true;

  map.on("mouseenter", "magnetic-raster", () => {
    map.getCanvas().style.cursor = "crosshair";
  });
  map.on("mouseleave", "magnetic-raster", () => {
    map.getCanvas().style.cursor = "";
    hoverPopup?.remove();
  });
  map.on("mousemove", "magnetic-raster", (event) => {
    const value = sampleMagneticValue(event.lngLat.lng, event.lngLat.lat);
    if (value === null) {
      hoverPopup?.remove();
      return;
    }

    if (!hoverPopup) {
      hoverPopup = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: "mh370-popup",
        maxWidth: "180px",
      });
    }

    hoverPopup
      .setLngLat(event.lngLat)
      .setHTML(`<strong>EMAG2</strong><br/>${Math.round(value)} nT`)
      .addTo(map);
  });
}

function sampleMagneticValue(lon: number, lat: number): number | null {
  if (!rasterState) return null;
  if (lon < WEST || lon > EAST || lat < SOUTH || lat > NORTH) return null;

  const x = Math.round(((lon - WEST) / (EAST - WEST)) * (rasterState.width - 1));
  const y = Math.round(((NORTH - lat) / (NORTH - SOUTH)) * (rasterState.height - 1));
  const index = y * rasterState.width + x;
  const value = rasterState.values[index];
  if (!Number.isFinite(value) || (rasterState.noData !== null && value === rasterState.noData)) {
    return null;
  }
  return value;
}

function colorRamp(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped < 0.5) {
    const t = clamped / 0.5;
    return [Math.round(37 + t * 218), Math.round(99 + t * 140), 235];
  }
  const t = (clamped - 0.5) / 0.5;
  return [239, Math.round(239 - t * 149), Math.round(255 - t * 173)];
}
