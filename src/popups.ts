import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";

let popup: mapboxgl.Popup | null = null;
let popupsBound = false;

function showPopup(map: MapboxMap, e: MapMouseEvent, html: string): void {
  if (popup) popup.remove();
  popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: true,
    className: "mh370-popup",
    maxWidth: "260px",
  })
    .setLngLat(e.lngLat)
    .setHTML(html)
    .addTo(map);
}

function setCursor(map: MapboxMap, cursor: string): void {
  map.getCanvas().style.cursor = cursor;
}

/** Set up hover/click popups for all interactive layers */
export function setupPopups(map: MapboxMap): void {
  if (popupsBound) return;
  popupsBound = true;

  // --- Arc rings: click to show BTO/BFO ---
  if (map.getLayer("arcs-lines")) {
    map.on("mouseenter", "arcs-lines", () => setCursor(map, "pointer"));
    map.on("mouseleave", "arcs-lines", () => setCursor(map, ""));
    map.on("click", "arcs-lines", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>Arc ${props.arc}</strong><br/>
         Time: ${props.time} UTC<br/>
         Range: ${props.range_km} km`
      );
    });
  }

  // --- Debris markers: click for details ---
  if (map.getLayer("debris-markers")) {
    map.on("mouseenter", "debris-markers", () => setCursor(map, "pointer"));
    map.on("mouseleave", "debris-markers", () => setCursor(map, ""));
    map.on("click", "debris-markers", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>${props.name}</strong><br/>
         Found: ${props.date}<br/>
         Location: ${props.location}<br/>
         Status: ${props.confirmation}<br/>
         Barnacles: ${props.barnacles}`
      );
    });
  }

  const pathLayers = [
    "paths-slow-lines",
    "paths-perpendicular-lines",
    "paths-mixed-lines",
    "paths-other-lines",
  ];
  for (const layerId of pathLayers) {
    if (!map.getLayer(layerId)) continue;
    map.on("mouseenter", layerId, () => setCursor(map, "pointer"));
    map.on("mouseleave", layerId, () => setCursor(map, ""));
    map.on("click", layerId, (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>${props.family} family path</strong><br/>
         Score: ${props.score}<br/>
         Arc 7 fuel: ${props.fuel} kg<br/>
         FIRs crossed: ${props.firs || "none"}`
      );
    });
  }

  if (map.getLayer("airspaces-fill")) {
    map.on("mouseenter", "airspaces-fill", () => setCursor(map, "pointer"));
    map.on("mouseleave", "airspaces-fill", () => setCursor(map, ""));
    map.on("click", "airspaces-fill", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>${props.name}</strong><br/>
         ${props.icao} · ${props.type} · ${props.country}<br/>
         <br/><em>${props.detection_status}</em><br/>
         <br/>${props.radar_coverage}<br/>
         <br/>${props.mh370_notes}`
      );
    });
  }

  if (map.getLayer("holidays-fill")) {
    map.on("mouseenter", "holidays-fill", () => setCursor(map, "pointer"));
    map.on("mouseleave", "holidays-fill", () => setCursor(map, ""));
    map.on("click", "holidays-fill", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>Data holiday</strong><br/>
         Priority: ${props.priority}<br/>
         Area: ${props.area_km2} km²<br/>
         Issue: ${props.quality_issue}<br/>
         <br/>${props.description}<br/>
         <br/><em>${props.source}</em>`
      );
    });
  }

  if (map.getLayer("priority-fill")) {
    map.on("mouseenter", "priority-fill", () => setCursor(map, "pointer"));
    map.on("mouseleave", "priority-fill", () => setCursor(map, ""));
    map.on("click", "priority-fill", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>Priority gap</strong><br/>
         Probability: ${(Number(props.probability) * 100).toFixed(2)}%<br/>
         ${props.label}`
      );
    });
  }

  if (map.getLayer("anomalies-markers")) {
    map.on("mouseenter", "anomalies-markers", () => setCursor(map, "pointer"));
    map.on("mouseleave", "anomalies-markers", () => setCursor(map, ""));
  }

  // --- Key points: click for name ---
  if (map.getLayer("points-markers")) {
    map.on("mouseenter", "points-markers", () => setCursor(map, "pointer"));
    map.on("mouseleave", "points-markers", () => setCursor(map, ""));
    map.on("click", "points-markers", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(map, e, `<strong>${props.name}</strong>`);
    });
  }

  // --- Flight path waypoints: click for name + time ---
  if (map.getLayer("flightpath-waypoint-dots")) {
    map.on("mouseenter", "flightpath-waypoint-dots", () => setCursor(map, "pointer"));
    map.on("mouseleave", "flightpath-waypoint-dots", () => setCursor(map, ""));
    map.on("click", "flightpath-waypoint-dots", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(
        map,
        e,
        `<strong>${props.name}</strong><br/>
         ${props.time} UTC`
      );
    });
  }

  // --- Searched areas: click for name ---
  if (map.getLayer("searched-fill")) {
    map.on("click", "searched-fill", (e) => {
      const props = e.features?.[0]?.properties;
      if (!props) return;
      showPopup(map, e, `<strong>${props.name}</strong>`);
    });
  }
}
