import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, GeoJSONSource, Marker } from 'maplibre-gl';
import type { MapRenderer } from './MapRenderer';
import type { Building, RouteResult } from './types';

const ROUTE_SOURCE = 'selected-walking-route';
const ROUTE_LAYER = 'selected-walking-route-line';
const UTEP_CENTER: [number, number] = [-106.504, 31.771];

/** MapLibre is for display only. It never computes a path. */
export class MapLibreRenderer implements MapRenderer {
  readonly map: MapLibreMap;
  private markers: Marker[] = [];
  private pendingRoute: RouteResult | null = null;
  private ready = false;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      center: UTEP_CENTER,
      zoom: 15.5,
      // Public OSM raster tiles for development only. Use a team-approved tile
      // service in production and comply with its attribution/usage policies.
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm-base', type: 'raster', source: 'osm' }]
      }
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.on('load', () => {
      this.map.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: this.routeFeature(null)
      });
      this.map.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        paint: { 'line-color': '#f47721', 'line-width': 6, 'line-opacity': 0.95 },
        layout: { 'line-join': 'round', 'line-cap': 'round' }
      });
      this.ready = true;
      this.setRoute(this.pendingRoute);
    });
  }

  setBuildings(buildings: Building[]): void {
    for (const marker of this.markers) marker.remove();
    this.markers = buildings.map((building) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'campus-marker';
      el.title = building.name;
      el.setAttribute('aria-label', building.name);
      el.textContent = '●';
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(building.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 18 }).setText(building.name))
        .addTo(this.map);
      return marker;
    });
  }

  setRoute(route: RouteResult | null): void {
    this.pendingRoute = route;
    if (!this.ready) return;
    (this.map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData(this.routeFeature(route));
    if (route) {
      const bounds = new maplibregl.LngLatBounds(route.coordinates[0], route.coordinates[0]);
      for (const coord of route.coordinates) bounds.extend(coord);
      this.map.fitBounds(bounds, { padding: 75, maxZoom: 17, duration: 600 });
    }
  }

  private routeFeature(route: RouteResult | null): GeoJSON.FeatureCollection<GeoJSON.LineString> {
    return {
      type: 'FeatureCollection',
      features: route ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } }] : []
    };
  }

  destroy(): void {
    for (const marker of this.markers) marker.remove();
    this.map.remove();
  }
}
