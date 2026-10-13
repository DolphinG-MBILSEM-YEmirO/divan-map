/**
 * Explanation cards for the Turkish-labelled redraw of the map.
 *
 * Wherever the pointer rests on the map (a label, a line, a coloured area, a dot, or even empty
 * ground) a small card explains what is there, which sources say so, and where nothing is known.
 * Cards are our own DOM, not Leaflet popups or tooltips.
 *
 * How a point is explained (first match wins):
 *   1. a "label" annotation (the area of a written name),
 *   2. a "shape" annotation (a hand-drawn region that must beat the colour under it),
 *   3. the outer ring (by distance from the circle centre),
 *   4. the colour under the pointer (red line, blue line, teal water, yellow dot, grey dots, sand),
 *   5. an "area" annotation (a large region such as a country),
 *   6. empty ground, or the outside of the circle.
 *
 * Annotation coordinates are pixels of the redraw image (see data/map-annotations.json).
 * All card text comes from data files and is added with textContent only.
 */
import { ANNOTATION_KIND, ANNOTATION_STATUS, EQUIVALENT_STATUS } from './labels.js';
import { el, normalizeText } from './text.js';

const L = window.L;

const HOVER_RADIUS_PX = 5; // pointer tolerance on screen, converted to image pixels
const TOUCH_ONLY = window.matchMedia('(hover: none)').matches;
const NEAR_LIMITS = { dot: 130, sea: 280, dotted: 420 }; // how far a "nearest label" may be, in image pixels
const NEAR_CLASS_KEY = { 'settlement-dot': 'dot', 'sea-fill': 'sea', 'dotted-line': 'dotted' };

// ------------------------------------------------------------------ geometry

function makeShape(area) {
  if (Array.isArray(area)) {
    const [x, y, w, h] = area;
    return {
      kind: 'rect', minX: x, minY: y, maxX: x + w, maxY: y + h, size: w * h,
      contains: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h,
    };
  }
  const pts = area.poly;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  let twice = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    twice += x1 * y2 - x2 * y1;
  }
  return {
    kind: 'poly', minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), size: Math.abs(twice) / 2,
    contains: (px, py) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    },
  };
}

/** Distance from a point to a shape's bounding box (0 inside). Good enough for "nearest label". */
function boxDistance(shape, x, y) {
  const dx = Math.max(shape.minX - x, 0, x - shape.maxX);
  const dy = Math.max(shape.minY - y, 0, y - shape.maxY);
  return Math.hypot(dx, dy);
}

// -------------------------------------------------------------- colour classes

const isRed = (r, g, b) => r > 215 && g > 70 && g < 165 && b > 70 && b < 165 && r - g > 80;
const isBlue = (r, g, b) => r < 110 && b > 150 && b - g > 20;
const isTeal = (r, g, b) => r < 100 && g > 125 && Math.abs(g - b) < 22;
const isDot = (r, g, b) => r > 228 && g > 195 && g < 245 && b > 70 && b < 165 && g - b > 50;
const isSand = (r, g, b) => r > 245 && g > 236 && b > 170 && b < 230 && g - b > 20;
const isGrey = (r, g, b) => Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && r > 150 && r < 238;

/** Loads the redraw into a canvas so colours can be read. Resolves to ImageData, or null when that is not possible. */
function readPixels(path, width, height) {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return resolve(null);
          context.drawImage(image, 0, 0, width, height);
          resolve(context.getImageData(0, 0, width, height));
        } catch {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = path;
    } catch {
      resolve(null);
    }
  });
}

// -------------------------------------------------------------------- module

/**
 * @param {object} options
 * @param {import('./maps.js').MapView} options.view The schematic map view (must have a redraw base).
 * @param {HTMLElement} options.pane The .map-pane element the card is placed in.
 * @param {object} options.config Parsed data/config.json.
 * @param {object} options.data Parsed data/map-annotations.json.
 * @param {Map<string, object>} options.sourcesById
 * @param {Map<string, object>} options.equivalentsById Records of data/modern-equivalents.json by id.
 * @param {(sourceId: string) => void} options.onOpenSource
 */
export function createExplainer({ view, pane, config, data, sourcesById, equivalentsById, onOpenSource }) {
  const map = view.map;
  const container = map.getContainer();
  const redraw = config.redrawMap;
  const circle = redraw.circle;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Prepared annotations: shapes with bounding boxes, split by layer.
  const annotations = data.annotations.map((a) => ({ ...a, shapes: a.areas.map(makeShape) }));
  const byId = new Map(annotations.map((a) => [a.id, a]));
  const layers = { label: [], shape: [], area: [] };
  annotations.forEach((a) => layers[a.layer ?? 'label'].push(a));

  let pixels = null; // ImageData of the redraw, once loaded
  let active = false;
  let pinned = false;
  let currentKey = null;
  let frame = 0;
  let lastEvent = null;
  let dragging = false;

  // ------------------------------------------------------------- the card

  const card = el('aside', { class: 'xcard', 'aria-label': 'Harita açıklaması', hidden: true });
  pane.append(card);

  // ----------------------------------------------------------- hit testing

  function imagePointToCircleRatio(x, y) {
    return Math.hypot((x - circle.cx) / circle.r, (y - circle.cy) / circle.r);
  }

  /** Reads the colours around a point and returns the id of a colour class, or null. */
  function classifyColour(x, y, radius) {
    if (!pixels) return null;
    const { width, height, data: rgba } = pixels;
    const step = Math.max(1, Math.round(radius / 5));
    const counts = { dot: 0, red: 0, blue: 0, teal: 0, grey: 0, sand: 0 };
    let total = 0;
    for (let dy = -radius; dy <= radius; dy += step) {
      for (let dx = -radius; dx <= radius; dx += step) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        total += 1;
        if (isDot(r, g, b)) counts.dot += 1;
        else if (isRed(r, g, b)) counts.red += 1;
        else if (isBlue(r, g, b)) counts.blue += 1;
        else if (isTeal(r, g, b)) counts.teal += 1;
        else if (isSand(r, g, b)) counts.sand += 1;
        else if (isGrey(r, g, b)) counts.grey += 1;
      }
    }
    if (!total) return null;
    if (counts.dot / total >= 0.06) return 'settlement-dot';
    if (counts.red / total >= 0.07) return 'mountain-line';
    if (counts.blue / total >= 0.07) return 'river-line';
    if (counts.teal / total >= 0.1) return 'sea-fill';
    if (counts.grey / total >= 0.1) return 'dotted-line';
    if (counts.sand / total >= 0.5) return 'sand-fill';
    return null;
  }

  function smallest(list, x, y) {
    let best = null;
    for (const annotation of list) {
      for (const shape of annotation.shapes) {
        if (shape.contains(x, y) && (!best || shape.size < best.size)) best = { annotation, size: shape.size };
      }
    }
    return best?.annotation ?? null;
  }

  /** The label nearest to a point among those linked to a colour class (for "Yakınındaki yazı"). */
  function nearestLinked(classId, x, y) {
    const key = NEAR_CLASS_KEY[classId];
    if (!key) return null;
    let best = null;
    for (const annotation of layers.label) {
      if (!annotation.link?.includes(key)) continue;
      for (const shape of annotation.shapes) {
        const distance = boxDistance(shape, x, y);
        if (distance <= NEAR_LIMITS[key] && (!best || distance < best.distance)) best = { annotation, distance };
      }
    }
    return best?.annotation ?? null;
  }

  /** Explains one image point. `radius` is the tolerance in image pixels. */
  function hitTest(x, y, radius = 4) {
    if (x < 0 || y < 0 || x > redraw.width || y > redraw.height) return { classId: 'outside' };
    const label = smallest(layers.label, x, y);
    if (label) return { annotation: label };
    const shape = smallest(layers.shape, x, y);
    if (shape) return { annotation: shape };
    const ratio = imagePointToCircleRatio(x, y);
    if (ratio > 1.03) return { classId: 'outside' };
    if (ratio >= circle.oceanFromRatio) return { classId: 'ocean-ring' };
    const classId = classifyColour(x, y, Math.max(2, Math.round(radius)));
    if (classId) return { classId, near: nearestLinked(classId, x, y) };
    const area = smallest(layers.area, x, y);
    if (area) return { annotation: area };
    return { classId: 'empty-land' };
  }

  // -------------------------------------------------------------- rendering

  function sourceList(refs) {
    if (!refs?.length) return null;
    const list = el('ul', { class: 'xcard__sources' });
    let unverified = false;
    for (const ref of refs) {
      const source = sourcesById.get(ref.source_id);
      const name = source?.short ?? source?.title ?? ref.source_id;
      if (source && source.citation_verified === false) unverified = true;
      const button = el('button', { type: 'button', class: 'link-btn', 'aria-label': `Kaynakçada aç: ${name}` }, name);
      button.addEventListener('click', () => onOpenSource(ref.source_id));
      list.append(el('li', {}, button, ref.locator ? el('span', { class: 'xcard__locator' }, ` · ${ref.locator}`) : null));
    }
    return el(
      'div',
      { class: 'xcard__block' },
      el('p', { class: 'xcard__label' }, 'Kaynak'),
      list,
      unverified ? el('p', { class: 'xcard__fine' }, 'Künyesi “doğrulanacak” olan kaynakların yayın bilgileri ve sayfa numaraları henüz teyit edilmemiştir.') : null,
    );
  }

  function equivalentBlock(id) {
    const record = id ? equivalentsById.get(id) : null;
    if (!record) return null;
    const status = EQUIVALENT_STATUS[record.status];
    return el(
      'div',
      { class: 'xcard__block' },
      el('p', { class: 'xcard__label' }, 'Günümüzdeki karşılığı (araştırmacılara göre)'),
      el('p', { class: 'xcard__equiv' }, record.modern_equivalent),
      status ? el('p', { class: 'xcard__fine' }, `${status.symbol} ${status.label}${record.note ? ` — ${record.note}` : ''}`) : null,
    );
  }

  /** Builds the card content for a hit. Returns a stable key so unchanged hits are not re-rendered. */
  function describe(hit) {
    if (hit.annotation) {
      const a = hit.annotation;
      return {
        key: `a:${a.id}`,
        title: a.label,
        kind: ANNOTATION_KIND[a.kind] ?? '',
        status: a.status,
        paragraphs: a.paragraphs,
        sources: a.sources,
        equivalentId: a.equivalentId,
        near: null,
      };
    }
    const info = data.classes[hit.classId];
    return {
      key: `c:${hit.classId}:${hit.near?.id ?? ''}`,
      title: info.title,
      kind: ANNOTATION_KIND[info.kind] ?? '',
      status: info.status,
      paragraphs: info.paragraphs,
      sources: info.sources,
      equivalentId: null,
      near: hit.near ?? null,
    };
  }

  function render(content, { isPinned }) {
    const status = ANNOTATION_STATUS[content.status];
    const parts = [];

    const head = el('div', { class: 'xcard__head' });
    const titles = el('div', {}, el('p', { class: 'xcard__kind' }, content.kind), el('h3', { class: 'xcard__title' }, content.title));
    head.append(titles);
    if (isPinned) {
      const close = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Açıklama kartını kapat' }, '×');
      close.addEventListener('click', unpin);
      head.append(close);
    }
    parts.push(head);

    if (status) parts.push(el('p', { class: `xcard__status xcard__status--${content.status}` }, el('span', { 'aria-hidden': 'true' }, `${status.symbol} `), status.label));

    content.paragraphs.forEach((text) => parts.push(el('p', { class: 'xcard__text' }, text)));

    if (content.status === 'label-only') {
      parts.push(el('p', { class: 'xcard__nosource' }, 'Bu yazı için elimizdeki kaynaklarda ayrıntılı bir açıklama bulunamadı; kaynak taraması sürüyor. Bu kart bilgi değil, yalnızca yazının kendisini gösterir.'));
    } else if (content.status === 'interpretation') {
      parts.push(el('p', { class: 'xcard__nosource' }, ANNOTATION_STATUS.interpretation.help));
    }

    if (content.near) {
      parts.push(
        el('p', { class: 'xcard__near' }, `Yakınındaki yazı: ${content.near.label}. Bu işaretin o yeri gösterdiği kesin değildir; yalnızca yakınlığa dayanır.`),
      );
    }

    const equivalent = equivalentBlock(content.equivalentId);
    if (equivalent) parts.push(equivalent);
    const sources = sourceList(content.sources);
    if (sources) parts.push(sources);

    card.replaceChildren(...parts);
    card.classList.toggle('is-pinned', isPinned);
  }

  function placeCard(containerPoint) {
    // On a narrow pane (phones) the card is a sheet at the top or bottom edge, on the side away from the pointer.
    const sheet = pane.clientWidth < 420 || TOUCH_ONLY;
    card.classList.toggle('xcard--sheet', sheet);
    if (sheet) {
      const pointerInLowerHalf = containerPoint.y > container.clientHeight / 2;
      card.style.left = '';
      card.style.top = pointerInLowerHalf ? `${container.offsetTop + 6}px` : '';
      card.style.bottom = pointerInLowerHalf ? '' : '6px';
      return;
    }
    card.style.bottom = '';
    const gap = 16;
    const offsetLeft = container.offsetLeft;
    const offsetTop = container.offsetTop;
    const paneWidth = pane.clientWidth;
    const paneHeight = pane.clientHeight;
    card.style.left = '0px';
    card.style.top = '0px';
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    let left = offsetLeft + containerPoint.x + gap;
    let top = offsetTop + containerPoint.y + gap;
    if (left + width > paneWidth - 6) left = offsetLeft + containerPoint.x - gap - width;
    if (top + height > paneHeight - 6) top = offsetTop + containerPoint.y - gap - height;
    card.style.left = `${Math.max(6, Math.min(left, paneWidth - width - 6))}px`;
    card.style.top = `${Math.max(offsetTop + 6, Math.min(top, paneHeight - height - 6))}px`;
  }

  function hide() {
    card.hidden = true;
    currentKey = null;
  }

  function show(containerPoint, hit, { isPinned }) {
    const content = describe(hit);
    if (content.key !== currentKey || card.classList.contains('is-pinned') !== isPinned) {
      render(content, { isPinned });
      currentKey = content.key;
    }
    card.hidden = false;
    card.classList.toggle('is-instant', reducedMotion);
    placeCard(containerPoint);
  }

  // ------------------------------------------------------------ interaction

  /** Image-pixel coordinates and tolerance for a pointer position given as a Leaflet event. */
  function pointFromEvent(event) {
    const { x, y } = view.latLngToRedrawPixel(event.latlng);
    const offset = map.containerPointToLatLng(event.containerPoint.add([HOVER_RADIUS_PX, 0]));
    const edge = view.latLngToRedrawPixel(offset);
    return { x, y, radius: Math.abs(edge.x - x) };
  }

  function inspect(event, isPinned) {
    const { x, y, radius } = pointFromEvent(event);
    show(event.containerPoint, hitTest(x, y, radius), { isPinned });
  }

  function onMove(event) {
    if (!active || pinned || dragging) return;
    lastEvent = event;
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (active && !pinned && !dragging && lastEvent) {
        inspect(lastEvent, false);
      }
    });
  }

  function onClick(event) {
    if (!active) return;
    pinned = true;
    inspect(event, true);
  }

  function unpin() {
    pinned = false;
    hide();
  }

  function onKey(event) {
    if (event.key === 'Escape' && pinned && !document.querySelector('dialog[open]')) {
      unpin();
      event.stopPropagation();
    }
  }

  map.on('mousemove', onMove);
  map.on('click', onClick);
  map.on('movestart zoomstart', () => {
    dragging = true;
    if (!pinned) hide();
  });
  map.on('moveend zoomend', () => {
    dragging = false;
  });
  container.addEventListener('mouseleave', () => {
    if (!pinned) hide();
  });
  document.addEventListener('keydown', onKey, true);

  // ------------------------------------------------------------- public API

  function setActive(on) {
    active = Boolean(on);
    container.classList.toggle('is-explainable', active);
    if (!active) {
      pinned = false;
      hide();
    }
  }

  /** Scrolls the map to an annotation and pins its card there (used by the list of labels). */
  function focusAnnotation(id) {
    const annotation = byId.get(id);
    if (!annotation) return false;
    const shape = annotation.shapes[0];
    const cx = (shape.minX + shape.maxX) / 2;
    const cy = (shape.minY + shape.maxY) / 2;
    const latlng = view.redrawPixelToLatLng(cx, cy);
    const zoom = Math.max(map.getZoom(), map.getBoundsZoom(view.bounds) + 1);
    map.setView(latlng, zoom, { animate: false });
    const containerPoint = map.latLngToContainerPoint(latlng);
    pinned = true;
    show(containerPoint, { annotation }, { isPinned: true });
    return true;
  }

  readPixels(redraw.imagePath, redraw.width, redraw.height).then((data) => {
    pixels = data;
  });

  return {
    annotations,
    classes: data.classes,
    setActive,
    focusAnnotation,
    hitTest: (x, y, radius) => describe(hitTest(x, y, radius)),
    hasPixels: () => Boolean(pixels),
    searchText: (annotation) => normalizeText([annotation.label, ...annotation.paragraphs].join(' ')),
    hide: unpin,
  };
}
