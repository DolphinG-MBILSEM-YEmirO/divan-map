/**
 * Research findings on the modern base map.
 *
 * Every entry of data/modern-equivalents.json that the sources allow us to place gets a rough shape on the
 * present-day map (an area, a frame or a line). The shapes show where researchers think the old names
 * lie today; they are NOT borders, coastlines or river beds, and the cards and the legend say so. How well the
 * sources agree is encoded by the line style (solid, dashed, dotted) and always repeated in words.
 *
 * Entries without a defensible position are not drawn; the legend lists them with the reason.
 * Hovering a shape explains it (own card, no Leaflet popup), clicking pins the card, and the linked
 * labels of the original map are outlined on the other map.
 */
import { EQUIVALENT_STATUS } from './labels.js';
import { buildSourceBlock, markClipped, placeBeside } from './cardparts.js';
import { el } from './text.js';

const L = window.L;
const TOUCH_ONLY = window.matchMedia('(hover: none)').matches;

/**
 * Line style of each status. Colour is never the only carrier of meaning: the dash pattern differs too,
 * and every card repeats the status in words. The colours match the legend samples in css/styles.css (--geo-*).
 */
const STATUS_STYLE = {
  agreed: { color: '#2e6b3c', dashArray: null, weight: 2.5 },
  single: { color: '#1b5e8c', dashArray: '10 6', weight: 2.5 },
  tentative: { color: '#8a4b00', dashArray: '3 6', weight: 3, lineCap: 'round' },
  disputed: { color: '#8f2d20', dashArray: '1 7', weight: 3, lineCap: 'round' },
};

function boundsOfGeometry(geometry) {
  if (geometry.type === 'box') return L.latLngBounds(geometry.bounds);
  if (geometry.type === 'circle') return L.latLng(geometry.center).toBounds(geometry.radius_km * 2000);
  const lines = geometry.type === 'lines' ? geometry.lines : [geometry.points];
  return L.latLngBounds(lines.flat());
}

function labelPosition(geometry) {
  if (geometry.type === 'circle') return L.latLng(geometry.center);
  if (geometry.type === 'box') return L.latLngBounds(geometry.bounds).getCenter();
  const line = geometry.type === 'lines' ? geometry.lines[0] : geometry.points;
  return L.latLng(line[Math.floor(line.length / 2)]);
}

/**
 * @param {object} options
 * @param {import('./maps.js').MapView} options.view The modern map view.
 * @param {HTMLElement} options.pane The .map-pane that holds the map (cards and legend are placed in it).
 * @param {object} options.geo Parsed data/modern-geo.json.
 * @param {object[]} options.equivalents Records of data/modern-equivalents.json.
 * @param {object[]} options.annotations Prepared annotations of the original map (for the "show on the original map" links).
 * @param {Map<string, object>} options.sourcesById
 * @param {(sourceId: string) => void} options.onOpenSource
 * @param {(equivalentId: string|null) => void} [options.onHover] Called while a shape is hovered or pinned.
 * @param {(equivalentId: string) => void} [options.onShowOnOriginal] Called by the "Özgün haritada göster" button.
 */
export function createModernLayer({ view, pane, geo, equivalents, annotations, sourcesById, onOpenSource, onHover = () => {}, onShowOnOriginal = () => {} }) {
  const map = view.map;
  const container = map.getContainer();
  const equivalentsById = new Map(equivalents.map((r) => [r.id, r]));
  const annotationsByEquivalent = new Map();
  for (const annotation of annotations) {
    if (!annotation.equivalentId) continue;
    if (!annotationsByEquivalent.has(annotation.equivalentId)) annotationsByEquivalent.set(annotation.equivalentId, []);
    annotationsByEquivalent.get(annotation.equivalentId).push(annotation);
  }

  const groupLayers = {};
  for (const key of Object.keys(geo.groups)) groupLayers[key] = L.layerGroup().addTo(map);

  const entries = new Map(); // equivalentId -> { feature, record, layers, label, bounds }
  const placement = { side: null };
  let pinnedId = null;
  let hoverId = null;

  // ----------------------------------------------------------------- the card

  const card = el('aside', { class: 'xcard xcard--geo', 'aria-label': 'Günümüz karşılığı açıklaması', hidden: true });
  pane.append(card);

  function renderCard(entry, { isPinned }) {
    const { feature, record } = entry;
    const status = EQUIVALENT_STATUS[record.status];
    const parts = [];

    const head = el('div', { class: 'xcard__head' }, el('div', {}, el('p', { class: 'xcard__kind' }, geo.groups[feature.group]), el('h3', { class: 'xcard__title' }, feature.label)));
    if (isPinned) {
      const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Açıklama kartını kapat' }, '×');
      close.addEventListener('click', unpin);
      head.append(close);
    }
    parts.push(head);

    if (status) parts.push(el('p', { class: `xcard__status xcard__status--${record.status}` }, el('span', { 'aria-hidden': 'true' }, `${status.symbol} `), status.label));
    parts.push(el('p', { class: 'xcard__text' }, el('strong', {}, 'Haritadaki ad: '), record.historical_name));
    parts.push(el('p', { class: 'xcard__text' }, el('strong', {}, 'Önerilen günümüz karşılığı: '), record.modern_equivalent));
    if (record.note) parts.push(el('p', { class: 'xcard__text' }, record.note));
    parts.push(el('p', { class: 'xcard__nosource' }, `Çizim hakkında: ${feature.geometryNote} Gösterilen şekil bir sınır ya da kesin konum değildir.`));

    const linked = annotationsByEquivalent.get(record.id) ?? [];
    if (linked.length) {
      const button = el('button', { type: 'button', class: 'btn btn--small' }, 'Özgün haritada göster');
      button.addEventListener('click', () => onShowOnOriginal(record.id));
      parts.push(el('div', { class: 'xcard__block' }, el('p', { class: 'xcard__label' }, 'Özgün haritadaki yazı'), el('p', { class: 'xcard__text' }, [...new Set(linked.map((a) => a.label))].join('; ')), button));
    }
    const sources = buildSourceBlock(record.sources, sourcesById, onOpenSource);
    if (sources) parts.push(sources);

    card.replaceChildren(...parts);
    card.classList.toggle('is-pinned', isPinned);
  }

  function showCard(id, containerPoint, { isPinned }) {
    const entry = entries.get(id);
    if (!entry) return;
    if (card.dataset.id !== id || card.classList.contains('is-pinned') !== isPinned) {
      renderCard(entry, { isPinned });
      card.dataset.id = id;
      card.scrollTop = 0;
    }
    card.hidden = false;
    placeBeside({ card, pane, container, point: containerPoint, touchOnly: TOUCH_ONLY, memory: placement });
    markClipped(card, isPinned);
  }

  function hideCard() {
    card.hidden = true;
    delete card.dataset.id;
  }

  function unpin() {
    pinnedId = null;
    hideCard();
    setEmphasis(null);
    onHover(null);
  }

  // ----------------------------------------------------------------- emphasis

  function setEmphasis(id) {
    for (const [key, entry] of entries) {
      const on = key === id;
      entry.layers.forEach((layer) => {
        const element = layer.getElement?.();
        if (element) element.classList.toggle('is-active', on);
        if (on) layer.bringToFront?.();
      });
      entry.label.getElement()?.classList.toggle('is-active', on);
    }
  }

  // ------------------------------------------------------------------- shapes

  function pathOptions(record) {
    const style = STATUS_STYLE[record.status] ?? STATUS_STYLE.single;
    return { className: `geo geo--${record.status}`, color: style.color, fillColor: style.color, weight: style.weight, dashArray: style.dashArray, lineCap: style.lineCap ?? 'butt', fillOpacity: 0.14, bubblingMouseEvents: false };
  }

  function buildLayers(feature, record) {
    const options = pathOptions(record);
    const g = feature.geometry;
    if (g.type === 'box') return [L.rectangle(g.bounds, options)];
    if (g.type === 'circle') return [L.circle(g.center, { ...options, radius: g.radius_km * 1000 })];
    const lines = g.type === 'lines' ? g.lines : [g.points];
    // A wide, invisible twin makes thin lines easy to hover.
    return lines.flatMap((points) => [
      L.polyline(points, { className: 'geo-halo', weight: 18, opacity: 0, bubblingMouseEvents: false }),
      L.polyline(points, { ...options, fill: false }),
    ]);
  }

  function wireLayer(layer, id) {
    layer.on('mouseover', (event) => {
      if (pinnedId) return;
      hoverId = id;
      setEmphasis(id);
      showCard(id, event.containerPoint, { isPinned: false });
      onHover(id);
    });
    layer.on('mousemove', (event) => {
      if (!pinnedId && hoverId === id) showCard(id, event.containerPoint, { isPinned: false });
    });
    layer.on('mouseout', () => {
      if (pinnedId) return;
      hoverId = null;
      hideCard();
      setEmphasis(null);
      onHover(null);
    });
    layer.on('click', (event) => {
      pinnedId = id;
      setEmphasis(id);
      showCard(id, event.containerPoint, { isPinned: true });
      onHover(id);
    });
  }

  // Large frames first, so small shapes stay on top and remain reachable.
  const order = { box: 0, circle: 1, line: 2, lines: 2 };
  const features = [...geo.features].sort((a, b) => order[a.geometry.type] - order[b.geometry.type]);
  for (const feature of features) {
    const record = equivalentsById.get(feature.equivalentId);
    if (!record) continue;
    const layers = buildLayers(feature, record);
    const labelHtml = el('span', { class: `geo-label geo-label--${record.status}` }, feature.label);
    const label = L.marker(labelPosition(feature.geometry), {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({ className: 'geo-label-wrap', html: labelHtml, iconSize: null }),
    });
    const group = groupLayers[feature.group];
    layers.forEach((layer) => {
      wireLayer(layer, record.id);
      group.addLayer(layer);
    });
    group.addLayer(label);
    entries.set(record.id, { feature, record, layers, label, bounds: boundsOfGeometry(feature.geometry) });
  }

  // Labels appear from zoom 5 on (and for the hovered shape at any zoom), so the first view stays readable.
  const syncLabels = () => container.classList.toggle('geo-labels-off', map.getZoom() < 5);
  map.on('zoomend', syncLabels);
  syncLabels();

  map.on('click', () => {
    if (pinnedId) unpin();
  });
  container.addEventListener('mouseleave', () => {
    if (!pinnedId) {
      hideCard();
      setEmphasis(null);
      hoverId = null;
      onHover(null);
    }
  });
  map.on('movestart zoomstart', () => {
    if (!pinnedId) hideCard();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && pinnedId && !document.querySelector('dialog[open]')) {
        unpin();
        event.stopPropagation();
      }
    },
    true,
  );

  // ------------------------------------------------------------------- legend

  const unplotted = Object.entries(geo.notPlotted ?? {})
    .map(([id, reason]) => ({ record: equivalentsById.get(id), reason }))
    .filter((item) => item.record);

  function legendSample(status) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 36 10');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '10');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '1');
    line.setAttribute('x2', '35');
    line.setAttribute('y1', '5');
    line.setAttribute('y2', '5');
    line.setAttribute('class', `geo-sample geo-sample--${status}`);
    line.setAttribute('stroke-width', String(STATUS_STYLE[status].weight));
    if (STATUS_STYLE[status].dashArray) line.setAttribute('stroke-dasharray', STATUS_STYLE[status].dashArray);
    if (STATUS_STYLE[status].lineCap) line.setAttribute('stroke-linecap', STATUS_STYLE[status].lineCap);
    svg.append(line);
    return svg;
  }

  function buildLegend() {
    const list = el('ul', { class: 'geo-legend__list' });
    for (const status of ['agreed', 'single', 'tentative', 'disputed']) {
      list.append(el('li', {}, legendSample(status), el('span', {}, `${EQUIVALENT_STATUS[status].symbol} ${EQUIVALENT_STATUS[status].label}`)));
    }
    const missing = unplotted.length
      ? el(
          'div',
          {},
          el('p', { class: 'geo-legend__label' }, 'Haritada gösterilmeyenler'),
          el('ul', { class: 'geo-legend__missing' }, unplotted.map((item) => el('li', {}, el('strong', {}, item.record.historical_name), ` — ${item.reason}`))),
        )
      : null;
    return el(
      'details',
      { class: 'geo-legend' },
      el('summary', {}, 'Gösterim ve notlar'),
      el('div', { class: 'geo-legend__body' }, list, el('p', { class: 'geo-legend__note' }, geo.geometryNote), missing),
    );
  }
  pane.append(buildLegend());

  // --------------------------------------------------------------- public API

  const count = (group) => features.filter((f) => f.group === group && entries.has(f.equivalentId)).length;

  return {
    entries,
    unplotted,
    count,
    has: (id) => entries.has(id),
    /** Shows or hides one group of shapes ('water' or 'place'). */
    setGroupVisible(group, visible) {
      const layer = groupLayers[group];
      if (!layer) return;
      if (visible) map.addLayer(layer);
      else map.removeLayer(layer);
      if (!visible && pinnedId && entries.get(pinnedId)?.feature.group === group) unpin();
    },
    /** Emphasises a shape without opening its card (linked from the original map). */
    highlight(id) {
      if (pinnedId) return;
      setEmphasis(id && entries.has(id) ? id : null);
    },
    /** Zooms to a shape and pins its card (used by the list of findings). */
    focus(id) {
      const entry = entries.get(id);
      if (!entry) return false;
      const group = entry.feature.group;
      if (!map.hasLayer(groupLayers[group])) map.addLayer(groupLayers[group]);
      map.fitBounds(entry.bounds.pad(0.5), { maxZoom: 7, animate: false });
      pinnedId = id;
      setEmphasis(id);
      showCard(id, map.latLngToContainerPoint(entry.bounds.getCenter()), { isPinned: true });
      onHover(id);
      return true;
    },
    hideCard: unpin,
  };
}
