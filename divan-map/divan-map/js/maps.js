/**
 * Map views built on Leaflet (loaded globally as window.L from vendor/leaflet).
 *
 * Two kinds of view share one class:
 *  - "schematic": the original Divanu Lugati't-Turk map. It is NOT a georeferenced map,
 *    so it uses a flat pixel-like coordinate system (L.CRS.Simple), x to the right, y upward.
 *  - "modern": a present-day base map (WGS84 / Web Mercator) used only as an aid
 *    for locating historical places approximately.
 *
 * Marker shape encodes how certain a location is; the letter and colour encode the category.
 */
import { CATEGORY_META } from './labels.js';
import { el } from './text.js';

const L = window.L;

/** Builds the Leaflet icon of a record. Static strings only; no record text is injected. */
export function makeIcon(record, selected = false) {
  const meta = CATEGORY_META[record.category];
  const classes = ['mk', `mk--${record.location_type}`];
  if (selected) classes.push('is-selected');
  const marker = el(
    'span',
    { class: classes.join(' '), style: `--c: var(${meta.cssVar})` },
    el('span', { class: 'mk__glyph' }, meta.glyph),
  );
  return L.divIcon({ className: 'mk-wrap', html: marker, iconSize: [30, 30], iconAnchor: [15, 15] });
}

export class MapView {
  /**
   * @param {object} options
   * @param {HTMLElement} options.container Element Leaflet draws into.
   * @param {'schematic'|'modern'} options.kind
   * @param {object} options.config Parsed data/config.json.
   * @param {(id: string) => void} options.onSelect Called when a marker is activated.
   * @param {(status: {type: string}) => void} [options.onStatus] Reports tile problems.
   */
  constructor({ container, kind, config, onSelect, onStatus }) {
    this.kind = kind;
    this.config = config;
    this.onSelect = onSelect;
    this.onStatus = onStatus ?? (() => {});
    this.entries = new Map(); // id -> { record, marker, area }
    this.selectedId = null;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.map = kind === 'schematic' ? this._createSchematicMap(container) : this._createModernMap(container);

    this.groups = {};
    for (const category of Object.keys(CATEGORY_META)) {
      this.groups[category] = L.layerGroup().addTo(this.map);
    }
  }

  // ---------------------------------------------------------------- creation

  _createSchematicMap(container) {
    const { width, height } = this.config.originalMap;
    this.bounds = L.latLngBounds([[0, 0], [height, width]]);
    const map = L.map(container, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.25,
      maxBounds: this.bounds.pad(0.5),
      maxBoundsViscosity: 0.8,
      attributionControl: false, // no Leaflet flag on the historical map; credits are shown below the map and in the bibliography
    });
    this._drawSchematicBase(map);
    this._createRedrawBase(map);
    map.fitBounds(this.bounds);
    return map;
  }

  /**
   * The Turkish-labelled redraw is a second base image for the same pane.
   * It keeps the pane's coordinate space (the original map's pixels) and is centred, at the same height.
   */
  _createRedrawBase(map) {
    const redraw = this.config.redrawMap;
    if (!redraw?.imagePath) return;
    const { width, height } = this.config.originalMap;
    const drawnWidth = (height * redraw.width) / redraw.height;
    const x0 = (width - drawnWidth) / 2;
    this.redrawBounds = L.latLngBounds([[0, x0], [height, x0 + drawnWidth]]);
    this.redrawLayer = L.imageOverlay(redraw.imagePath, this.redrawBounds, {
      attribution: '',
      alt: redraw.title ?? '',
      interactive: false,
    });
  }

  _drawSchematicBase(map) {
    const { imagePath, width, height, license } = this.config.originalMap;
    if (imagePath) {
      this.originalLayer = L.imageOverlay(imagePath, this.bounds, { attribution: '', alt: this.config.originalMap.title ?? '', interactive: false }).addTo(map);
      return;
    }
    // No licensed image yet: show an honest placeholder instead of an invented drawing.
    const base = L.layerGroup();
    L.rectangle(this.bounds, { color: '#5b6672', weight: 2, dashArray: '8 6', fill: true, fillColor: '#eef1f4', fillOpacity: 1, interactive: false }).addTo(base);
    const gridStyle = { color: '#9aa5b1', weight: 1, opacity: 0.6, interactive: false };
    for (let x = 100; x < width; x += 100) L.polyline([[0, x], [height, x]], gridStyle).addTo(base);
    for (let y = 100; y < height; y += 100) L.polyline([[y, 0], [y, width]], gridStyle).addTo(base);
    const note = el(
      'div',
      { class: 'schematic-note' },
      el('strong', {}, 'Özgün harita görseli henüz eklenmedi'),
      el('span', {}, 'Lisansı doğrulanmış görsel eklenene kadar yalnızca ızgaralı zemin görünür.'),
    );
    L.marker(this.bounds.getCenter(), {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: 'schematic-note-wrap', html: note, iconSize: [340, 70], iconAnchor: [170, 35] }),
    }).addTo(base);
    base.addTo(map);
    this.originalLayer = base;
  }

  _createModernMap(container) {
    const basemap = this.config.modernBasemap;
    const { center, zoom } = this.config.initialView.modern;
    // The Leaflet prefix is left out; the OpenStreetMap credit that its licence requires stays.
    const map = L.map(container, { minZoom: 2, maxZoom: basemap.maxZoom, worldCopyJump: true, attributionControl: false });
    L.control.attribution({ prefix: false }).addTo(map);
    map.setView(center, zoom);

    const tiles = L.tileLayer(basemap.urlTemplate, { attribution: basemap.attribution, maxZoom: basemap.maxZoom });
    let failures = 0;
    tiles.on('tileerror', () => {
      failures += 1;
      if (failures === 3) this.onStatus({ type: 'tiles-failed' });
    });
    tiles.on('tileload', () => {
      if (failures >= 3) this.onStatus({ type: 'tiles-ok' });
      failures = 0;
    });
    tiles.addTo(map);
    return map;
  }

  // ------------------------------------------------------------- base image

  /** Which base image the schematic pane shows: 'redraw' (Turkish-labelled) or 'original'. */
  get base() {
    return this._base ?? 'original';
  }

  hasRedraw() {
    return Boolean(this.redrawLayer);
  }

  /**
   * Switches the schematic base image. Record markers are placed on the original
   * image's pixels, so they are only shown on the original base.
   */
  setBase(name) {
    if (this.kind !== 'schematic') return;
    const next = name === 'redraw' && this.redrawLayer ? 'redraw' : 'original';
    if (next === this.base && this._base) return;
    this._base = next;
    if (this.redrawLayer) {
      if (next === 'redraw') {
        if (this.originalLayer) this.map.removeLayer(this.originalLayer);
        this.map.addLayer(this.redrawLayer);
      } else {
        this.map.removeLayer(this.redrawLayer);
        if (this.originalLayer) this.map.addLayer(this.originalLayer);
      }
    }
    for (const group of Object.values(this.groups ?? {})) {
      if (next === 'original') this.map.addLayer(group);
      else this.map.removeLayer(group);
    }
    this.onBaseChange?.(next);
  }

  /** Converts a map position to pixel coordinates of the redraw image (null when it is off the image). */
  latLngToRedrawPixel(latlng) {
    const b = this.redrawBounds;
    const { width, height } = this.config.redrawMap;
    const x = ((latlng.lng - b.getWest()) / (b.getEast() - b.getWest())) * width;
    const y = ((b.getNorth() - latlng.lat) / (b.getNorth() - b.getSouth())) * height;
    return { x, y };
  }

  redrawPixelToLatLng(x, y) {
    const b = this.redrawBounds;
    const { width, height } = this.config.redrawMap;
    return L.latLng(b.getNorth() - (y / height) * (b.getNorth() - b.getSouth()), b.getWest() + (x / width) * (b.getEast() - b.getWest()));
  }

  // ----------------------------------------------------------------- records

  _latLngFor(record) {
    if (this.kind === 'schematic') {
      return record.schematic_xy ? L.latLng(record.schematic_xy[1], record.schematic_xy[0]) : null;
    }
    return record.lat_lng ? L.latLng(record.lat_lng[0], record.lat_lng[1]) : null;
  }

  /** Replaces all markers with those of the given records (records without a position here are skipped). */
  setRecords(records) {
    for (const entry of this.entries.values()) {
      this.groups[entry.record.category].removeLayer(entry.marker);
      if (entry.area) this.groups[entry.record.category].removeLayer(entry.area);
    }
    this.entries.clear();

    for (const record of records) {
      const latlng = this._latLngFor(record);
      if (!latlng) continue;
      const suffix = record.is_demo ? ' (örnek içerik)' : '';
      const marker = L.marker(latlng, {
        icon: makeIcon(record),
        title: record.historical_name + suffix,
        alt: record.historical_name + suffix,
        keyboard: true,
        riseOnHover: true,
      });
      marker.on('click', () => this.onSelect(record.id));

      let area = null;
      const uncertain = record.location_type === 'approximate' || record.location_type === 'disputed';
      if (this.kind === 'modern' && uncertain && record.uncertainty_radius_km) {
        area = L.circle(latlng, {
          radius: record.uncertainty_radius_km * 1000,
          // Colour comes from CSS (.area--<category>) so it follows the theme variables.
          className: `area area--${record.category}`,
          color: '#555555',
          weight: 2,
          dashArray: record.location_type === 'disputed' ? '2 7' : '8 6',
          fillOpacity: 0.12,
          interactive: false,
        });
      }
      this.entries.set(record.id, { record, marker, area });
    }
  }

  has(id) {
    return this.entries.has(id);
  }

  /** Shows only the records whose id is in `visibleIds`. */
  showOnly(visibleIds) {
    for (const [id, entry] of this.entries) {
      const group = this.groups[entry.record.category];
      const visible = visibleIds.has(id);
      if (visible) {
        group.addLayer(entry.marker);
        if (entry.area) group.addLayer(entry.area);
      } else {
        group.removeLayer(entry.marker);
        if (entry.area) group.removeLayer(entry.area);
      }
    }
  }

  // --------------------------------------------------------------- selection

  select(id, { focus = false } = {}) {
    if (this.selectedId && this.entries.has(this.selectedId)) {
      const previous = this.entries.get(this.selectedId);
      previous.marker.setIcon(makeIcon(previous.record, false));
      previous.marker.setZIndexOffset(0);
    }
    this.selectedId = null;
    const entry = this.entries.get(id);
    if (!entry) return;
    this.selectedId = id;
    entry.marker.setIcon(makeIcon(entry.record, true));
    entry.marker.setZIndexOffset(1000);
    if (focus) this._focusEntry(entry);
  }

  clearSelection() {
    if (!this.selectedId) return;
    const entry = this.entries.get(this.selectedId);
    if (entry) {
      entry.marker.setIcon(makeIcon(entry.record, false));
      entry.marker.setZIndexOffset(0);
    }
    this.selectedId = null;
  }

  _focusEntry(entry) {
    const animate = !this.reducedMotion;
    if (entry.area && this.map.hasLayer(entry.area)) {
      this.map.fitBounds(entry.area.getBounds().pad(0.6), { maxZoom: 7, animate });
      return;
    }
    const minZoom = this.kind === 'modern' ? 5 : 1;
    this.map.setView(entry.marker.getLatLng(), Math.max(this.map.getZoom(), minZoom), { animate });
  }

  // -------------------------------------------------------------------- view

  resetView() {
    const animate = !this.reducedMotion;
    if (this.kind === 'schematic') {
      this.map.fitBounds(this.bounds, { animate });
    } else {
      const { center, zoom } = this.config.initialView.modern;
      this.map.setView(center, zoom, { animate });
    }
  }

  /** Call after the container changes size or becomes visible. */
  refreshSize() {
    this.map.invalidateSize();
  }
}
