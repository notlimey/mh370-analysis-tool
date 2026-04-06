import type { Map as MapboxMap } from "mapbox-gl";

const WMS = "https://warehouse.ausseabed.gov.au/geoserver/wms";

export interface SonarSource {
  id: string;
  label: string;
  description: string;
  layer: string;
  defaultOn: boolean;
  defaultOpacity: number;
}

export const SONAR_SOURCES: SonarSource[] = [
  {
    id: "auv",
    label: "AUV Side Scan Sonar",
    description: "Highest resolution AUV side scan sonar at 5m",
    layer: "ausseabed:MH370_Phase_2_Sonar_Imagery_Backscatter_Inverse_Autonomous_Underwater_Vehicle__SSS__5m_2018",
    defaultOn: true,
    defaultOpacity: 0.85,
  },
  {
    id: "deeptow",
    label: "Deep Tow Side Scan Sonar",
    description: "Primary wide-coverage deep tow search imagery",
    layer: "ausseabed:MH370_Phase_2_Sonar_Imagery_Backscatter_Inverse_Deep_Tow__SSS__5m_2018",
    defaultOn: true,
    defaultOpacity: 0.85,
  },
  {
    id: "gophoenix",
    label: "Go Phoenix Synthetic Aperture Sonar",
    description: "Higher fidelity SAS in partial coverage area",
    layer: "ausseabed:MH370_Phase_2_Go_Phoenix__SAS__5m_2018",
    defaultOn: false,
    defaultOpacity: 0.85,
  },
  {
    id: "bathymetry",
    label: "Bathymetry 150m",
    description: "Seabed depth and terrain context",
    layer: "ausseabed:Southern_Indian_Ocean__MH370__Bathymetry__150m_2017",
    defaultOn: false,
    defaultOpacity: 0.6,
  },
];

const SONAR_IDS_FOR_GROUP_OPACITY = ["auv", "deeptow", "gophoenix"];

export function loadSonarLayers(map: MapboxMap): void {
  for (const source of SONAR_SOURCES) {
    const sourceId = `sonar-${source.id}-source`;
    const layerId = `sonar-${source.id}-raster`;
    const tileUrl = `${WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(source.layer)}&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&FORMAT=image/png&TRANSPARENT=true`;

    map.addSource(sourceId, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution: "© Governments of Australia, Malaysia and PRC 2018",
    });

    map.addLayer(
      {
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": source.defaultOpacity,
          "raster-fade-duration": 300,
        },
        layout: {
          visibility: source.defaultOn ? "visible" : "none",
        },
      },
      "arcs-lines",
    );
  }
}

export function setSonarLayerVisible(map: MapboxMap, id: string, visible: boolean): void {
  const layerId = `sonar-${id}-raster`;
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function setSonarGroupOpacity(map: MapboxMap, opacity: number): void {
  for (const id of SONAR_IDS_FOR_GROUP_OPACITY) {
    const layerId = `sonar-${id}-raster`;
    if (!map.getLayer(layerId)) continue;
    map.setPaintProperty(layerId, "raster-opacity", opacity);
  }
}
