/**
 * The game board of game.html: the Turkish-labelled redraw in Leaflet (CRS.Simple), the walking camel
 * caravan, its route, flags at visited places and the outline used as help.
 * Positions are redraw-image pixels; this file converts them to Leaflet coordinates.
 */
const CLICK_TOLERANCE_PX = 10;

/** A camel facing right, drawn in a 48 × 36 box. */
const CAMEL = '<path class="cv-camel__body" d="M7 21c0-5 4-9 9-9 2-6 8-7 11-1 3 0 5 2 6 5l3-7c1-3 4-4 6-2l3 1-1 2h-3l-3 9c-1 3-3 4-5 4v9h-2.4l-.8-8H17l-.6 8H14v-8.4C10 24 7 23 7 21z"/>'
  + '<path class="cv-camel__load" d="M15 12.5c3-2 9-2.6 13-.6l-.4 3.6H15.4z"/>'
  + '<path class="cv-camel__tail" d="M7.5 19c-2 1-3 3-3 5" fill="none"/>';

/** A walking guide with a staff, drawn in a 20 × 36 box. */
const GUIDE = '<circle class="cv-guide__head" cx="10" cy="6" r="4"/>'
  + '<path class="cv-guide__body" d="M5 30l2-17c1-2 5-2 6 0l2 17z"/>'
  + '<path class="cv-guide__staff" d="M17 9l-1 26" fill="none"/>';

function caravanSvg() {
  const camel = (x, delay) => `<g transform="translate(${x} 2)"><g class="cv-camel" style="--delay:${delay}s">${CAMEL}</g></g>`;
  return `<svg class="cv-train" viewBox="0 0 156 40" width="195" height="50" aria-hidden="true">
    <path class="cv-rope" d="M40 21 L50 18 M86 21 L96 18 M132 21 L138 19" fill="none"/>
    ${camel(0, 0)}${camel(46, 0.15)}${camel(92, 0.3)}
    <g transform="translate(136 2)"><g class="cv-guide">${GUIDE}</g></g>
  </svg>`;
}

export function createBoard({ container, config, onClick }) {
  const L = window.L;
  const { width, height, imagePath, title } = config.redrawMap;
  const bounds = L.latLngBounds([[0, 0], [height, width]]);
  const map = L.map(container, {
    crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomSnap: 0.25,
    maxBounds: bounds.pad(0.25), maxBoundsViscosity: 0.8, attributionControl: false,
  });
  L.imageOverlay(imagePath, bounds, { alt: title ?? '', interactive: false }).addTo(map);
  map.fitBounds(bounds);

  const toLatLng = (p) => L.latLng(height - p.y, p.x);
  const toPixel = (ll) => ({ x: ll.lng, y: height - ll.lat });
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const route = L.polyline([], { className: 'cv-route', color: '#8f2d20', weight: 4, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(map);
  const flags = L.layerGroup().addTo(map);
  const help = L.layerGroup().addTo(map);
  const icon = L.divIcon({ className: 'cv-caravan', html: caravanSvg(), iconSize: [195, 50], iconAnchor: [97, 45] });
  let caravan = null;
  let position = null;

  map.on('click', (event) => {
    const point = toPixel(event.latlng);
    const edge = toPixel(map.containerPointToLatLng(event.containerPoint.add([CLICK_TOLERANCE_PX, 0])));
    onClick(point, Math.abs(edge.x - point.x));
  });

  function face(from, to) {
    caravan?.getElement()?.classList.toggle('is-left', to.x < from.x);
  }

  /** Puts the caravan at a point without animation and starts a new route there. */
  function place(point) {
    position = point;
    if (!caravan) caravan = L.marker(toLatLng(point), { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    else caravan.setLatLng(toLatLng(point));
    route.setLatLngs([toLatLng(point)]);
    flags.clearLayers();
    help.clearLayers();
  }

  /** Walks the caravan to a point; resolves when it has arrived. */
  function walk(to, { msPerPixel = 2.2 } = {}) {
    const from = position;
    position = to;
    face(from, to);
    const legBounds = L.latLngBounds([toLatLng(from), toLatLng(to)]);
    if (!map.getBounds().contains(legBounds)) map.fitBounds(legBounds.pad(0.6), { animate: false, maxZoom: map.getZoom() });
    const el = caravan.getElement();
    const duration = reducedMotion ? 0 : Math.min(3200, Math.max(900, Math.hypot(to.x - from.x, to.y - from.y) * msPerPixel));
    const done = () => {
      caravan.setLatLng(toLatLng(to));
      route.addLatLng(toLatLng(to));
      el?.classList.remove('is-walking');
    };
    if (!duration || typeof window.requestAnimationFrame !== 'function') {
      done();
      return Promise.resolve();
    }
    el?.classList.add('is-walking');
    const startTime = performance.now();
    const trail = L.polyline([toLatLng(from), toLatLng(from)], { className: 'cv-route cv-route--live', color: '#8f2d20', weight: 4, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(map);
    return new Promise((resolve) => {
      const step = (now) => {
        const t = Math.min(1, (now - startTime) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
        const p = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        caravan.setLatLng(toLatLng(p));
        trail.setLatLngs([toLatLng(from), toLatLng(p)]);
        if (t < 1) window.requestAnimationFrame(step);
        else {
          map.removeLayer(trail);
          done();
          resolve();
        }
      };
      window.requestAnimationFrame(step);
    });
  }

  /** A small flag at a delivered place, numbered in the order of the journey. */
  function flag(point, number, label) {
    const html = `<span class="cv-flag__pole"></span><span class="cv-flag__cloth">${number}</span>`;
    L.marker(toLatLng(point), {
      icon: L.divIcon({ className: 'cv-flag', html, iconSize: [26, 30], iconAnchor: [3, 30] }),
      interactive: false, keyboard: false, title: label,
    }).addTo(flags);
  }

  /** Outlines a place (help after two wrong tries). */
  function outline(shapes) {
    help.clearLayers();
    shapes.forEach((s) => {
      const corners = s.points ?? [[s.minX, s.minY], [s.maxX, s.minY], [s.maxX, s.maxY], [s.minX, s.maxY]];
      L.polygon(corners.map(([x, y]) => toLatLng({ x, y })), { className: 'cv-help', color: '#c2a24e', weight: 3, fillOpacity: 0.18, interactive: false }).addTo(help);
    });
  }

  return {
    map,
    place,
    walk,
    flag,
    outline,
    clearHelp: () => help.clearLayers(),
    fitRoute: () => { if (route.getLatLngs().length > 1) map.fitBounds(route.getBounds().pad(0.25), { animate: false }); },
    fitAll: () => map.fitBounds(bounds, { animate: false }),
    refresh: () => map.invalidateSize(),
  };
}
