/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.geojson" {
  const value: GeoJSON.FeatureCollection;
  export default value;
}

declare module "*.tiff" {
  const src: string;
  export default src;
}

declare module "*.tif" {
  const src: string;
  export default src;
}
