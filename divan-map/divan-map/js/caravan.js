/**
 * "Kâşgarlı'nın Kervanı": a journey game on the Turkish-labelled redraw of the map.
 *
 * The caravan starts at Kaşgar. It carries a few place names ("cargo"), each with a clue taken from
 * that place's explanation card (data/caravan.json). The player picks a name and clicks the place on
 * the map where it is written. A right delivery moves the caravan there and draws its route; a wrong
 * one gives a compass hint (in the map's own directions), and a second wrong one outlines the place.
 * Places that needed help go to a review list; delivered names go to "Sözlüğüm". Both lists stay on
 * this device only (storage.js).
 *
 * The pure helpers (stops, compass, cargo, review quiz) are exported for tests.
 * All text comes from data files and is added with textContent only.
 */
import { ANNOTATION_KIND, ANNOTATION_STATUS } from './labels.js';
import { el } from './text.js';
import { readLocal, writeLocal } from './storage.js';

export const WORDS_KEY = 'caravanWords';
export const REVIEW_KEY = 'caravanReview';
const PLAYABLE_STATUS = new Set(['sourced', 'partial']);
const CLICK_TOLERANCE_PX = 10;
const DIRECTION_WORDS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
const COMPASS_DEGREES = { kuzey: 0, dogu: 90, guney: 180, bati: 270 };

// ------------------------------------------------------------ pure helpers

/** Centre of an annotation's first area, in redraw image pixels. */
export function shapeCenter(shapes) {
  const s = shapes[0];
  return { x: (s.minX + s.maxX) / 2, y: (s.minY + s.maxY) / 2 };
}

/**
 * Joins the game data with the prepared annotations (those of explain.js, with `shapes`).
 * Stops whose card is missing, or not backed by a source, are left out.
 */
export function buildStops(caravanData, annotations) {
  const byId = new Map(annotations.map((a) => [a.id, a]));
  const toStop = (annotation, clue = '') => ({
    id: annotation.id,
    label: annotation.label,
    kind: annotation.kind,
    status: annotation.status,
    equivalentId: annotation.equivalentId ?? null,
    clue,
    shapes: annotation.shapes,
    center: shapeCenter(annotation.shapes),
  });
  const stops = (caravanData?.stops ?? [])
    .map((s) => ({ annotation: byId.get(s.id), clue: s.clue }))
    .filter(({ annotation, clue }) => annotation && clue && PLAYABLE_STATUS.has(annotation.status))
    .map(({ annotation, clue }) => toStop(annotation, clue));
  const startAnnotation = byId.get(caravanData?.start);
  return { start: startAnnotation ? toStop(startAnnotation) : null, stops };
}

/**
 * The map's own compass, read from the four direction labels around the circle. On this map "up" on the
 * screen is not north, so hints use these labels, never the screen. Returns null without the labels.
 */
export function buildCompass(annotations, circle) {
  const anchors = [];
  for (const [id, degrees] of Object.entries(COMPASS_DEGREES)) {
    const annotation = annotations.find((a) => a.id === id);
    if (!annotation) return null;
    const c = shapeCenter(annotation.shapes);
    let screen = Math.atan2(c.y - circle.cy, c.x - circle.cx);
    if (screen < 0) screen += 2 * Math.PI;
    anchors.push({ screen, degrees });
  }
  anchors.sort((a, b) => a.screen - b.screen);
  // Unwrap the compass degrees so they grow with the screen angle (both turn clockwise here).
  for (let i = 1; i < anchors.length; i += 1) {
    while (anchors[i].degrees < anchors[i - 1].degrees) anchors[i].degrees += 360;
  }
  return anchors;
}

/** Compass bearing (0 = north, 90 = east) from one image point to another, using the map's compass. */
export function compassBearing(compass, from, to) {
  let screen = Math.atan2(to.y - from.y, to.x - from.x);
  if (screen < 0) screen += 2 * Math.PI;
  const ring = [...compass, { screen: compass[0].screen + 2 * Math.PI, degrees: compass[0].degrees + 360 }];
  if (screen < ring[0].screen) screen += 2 * Math.PI;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (screen >= a.screen && screen <= b.screen) {
      const t = (screen - a.screen) / (b.screen - a.screen);
      return (((a.degrees + t * (b.degrees - a.degrees)) % 360) + 360) % 360;
    }
  }
  return 0;
}

/** One of eight Turkish direction words for a bearing. */
export function directionWord(degrees) {
  return DIRECTION_WORDS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

/** Picks up to `count` stops at random that are not in `excludeIds`. */
export function pickCargo(stops, excludeIds, count, random = Math.random) {
  const pool = stops.filter((s) => !excludeIds.has(s.id));
  const picked = [];
  while (picked.length < count && pool.length) picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return picked;
}

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * A short multiple-choice quiz from the clues: "which place does this clue describe?".
 * Places on the review list come first; the rest are filled at random. Same shape as data/quiz.json.
 */
export function buildReviewQuiz(stops, reviewIds = [], size = 5, random = Math.random) {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const chosen = [...new Set(reviewIds)].filter((id) => byId.has(id)).slice(0, size).map((id) => byId.get(id));
  chosen.push(...pickCargo(stops, new Set(chosen.map((s) => s.id)), size - chosen.length, random));
  const questions = chosen.map((stop, index) => {
    const wrong = pickCargo(stops.filter((s) => s.label !== stop.label), new Set([stop.id]), 3, random);
    const options = shuffle([stop, ...wrong], random).map((s, i) => ({ id: String.fromCharCode(97 + i), text: s.label, stopId: s.id }));
    return {
      id: `r${index + 1}`,
      stopId: stop.id,
      prompt: `“${stop.clue}” Bu ipucu haritadaki hangi yeri anlatıyor?`,
      options: options.map(({ id, text }) => ({ id, text })),
      correct: options.find((o) => o.stopId === stop.id).id,
      explanation: `${stop.label}. Kaynak durumu: ${ANNOTATION_STATUS[stop.status]?.label ?? stop.status}. İpucu bu yerin açıklama kartından alınmıştır.`,
    };
  });
  return { id: 'caravan-review', title: 'Pekiştirme testi', questions };
}

function addToList(key, id) {
  const list = readLocal(key, []);
  if (Array.isArray(list) && !list.includes(id)) writeLocal(key, [...list, id]);
}

/** Removes a place from the review list (after a right answer in the review quiz). */
export function forgetReview(id) {
  const list = readLocal(REVIEW_KEY, []);
  if (Array.isArray(list)) writeLocal(REVIEW_KEY, list.filter((x) => x !== id));
}

/** "Sözlüğüm": the names delivered on this device, each with its clue and a button to show it on the map. */
export function renderWordsList(container, stops, { onShow }) {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const ids = readLocal(WORDS_KEY, []);
  const words = (Array.isArray(ids) ? ids : []).map((id) => byId.get(id)).filter(Boolean);
  container.replaceChildren();
  if (!words.length) {
    container.append(el('p', {}, 'Henüz kelime toplamadın. "Pekiştir" menüsünden Kâşgarlı\'nın Kervanı\'nı başlat; teslim ettiğin yer adları burada birikir.'));
    return 0;
  }
  const review = new Set(readLocal(REVIEW_KEY, []));
  const list = el('ul', { class: 'words' });
  for (const word of words.sort((a, b) => a.label.localeCompare(b.label, 'tr'))) {
    const show = el('button', { type: 'button', class: 'btn btn--small' }, 'Haritada göster');
    show.addEventListener('click', () => onShow(word.id));
    list.append(el('li', { class: 'words__item' },
      el('div', { class: 'words__head' },
        el('strong', {}, word.label),
        el('span', { class: 'chip-static' }, ANNOTATION_KIND[word.kind] ?? word.kind),
        review.has(word.id) ? el('span', { class: 'words__review' }, 'Tekrar edilecek') : null,
      ),
      el('p', {}, word.clue),
      el('p', { class: 'hint' }, `${ANNOTATION_STATUS[word.status]?.symbol ?? ''} ${ANNOTATION_STATUS[word.status]?.label ?? ''}`),
      show,
    ));
  }
  container.append(el('p', { class: 'hint' }, `${words.length} / ${stops.length} yer adı toplandı.`), list);
  return words.length;
}

// --------------------------------------------------------------- the game

/**
 * @param {object} o
 * @param {import('./maps.js').MapView} o.view  the schematic map view (redraw base)
 * @param {HTMLElement} o.bar   empty <section> that becomes the game panel
 * @param {object} o.data       data/caravan.json
 * @param {Array} o.annotations prepared annotations of explain.js (with shapes)
 * @param {object} o.circle     config.redrawMap.circle
 */
export function createCaravan({ view, bar, data, annotations, circle, onStart = () => {}, onEnd = () => {}, onDelivered = () => false, onOpenCard = () => {}, onOpenWords = () => {}, onOpenReview = () => {}, random = Math.random }) {
  const L = window.L;
  const map = view.map;
  const { start, stops } = buildStops(data, annotations);
  const compass = buildCompass(annotations, circle);
  const labels = annotations.filter((a) => (a.layer ?? 'label') === 'label');
  const capacity = Math.max(1, data.capacity ?? 3);
  const journeyLength = Math.min(data.journeyLength ?? 8, stops.length);

  let running = false;
  let cargo = [];
  let selectedId = null;
  let delivered = [];
  let usedIds = new Set();
  let firstTry = 0;
  let attempts = 0;
  let position = null; // image point of the caravan
  let hideNames = false;
  let layers = null;

  // ------------------------------------------------------------ the panel

  const title = el('h2', { id: 'caravan-title', class: 'caravan__title' }, data.title ?? "Kâşgarlı'nın Kervanı");
  const progress = el('p', { class: 'caravan__progress' });
  const hardInput = el('input', { type: 'checkbox', id: 'caravan-hard' });
  const hardLabel = el('label', { class: 'caravan__hard', for: 'caravan-hard' }, hardInput, el('span', {}, 'Adları gizle (zor)'));
  const stopButton = el('button', { type: 'button', class: 'btn btn--small', id: 'caravan-stop' }, 'Yolculuğu bitir');
  const cargoList = el('ul', { class: 'caravan__cargo', id: 'caravan-cargo', 'aria-label': 'Kervandaki kelimeler' });
  const feedback = el('p', { class: 'caravan__feedback', id: 'caravan-feedback', role: 'status', 'aria-live': 'polite' });
  const cardButton = el('button', { type: 'button', class: 'btn btn--small', id: 'caravan-card', hidden: true }, 'Yerin kartını aç');
  const pick = el('select', { id: 'caravan-pick' });
  const pickButton = el('button', { type: 'button', class: 'btn btn--small', id: 'caravan-pick-go' }, 'Bu yere teslim et');
  const keys = el('details', { class: 'caravan__keys' },
    el('summary', {}, 'Klavyeyle oyna'),
    el('label', { for: 'caravan-pick' }, 'Yeri listeden seç'),
    pick,
    pickButton,
  );
  const note = el('details', { class: 'caravan__about' }, el('summary', {}, 'Bu oyunun verisi'), el('p', {}, data.notice ?? ''));
  const summary = el('div', { class: 'caravan__summary', hidden: true });

  bar.replaceChildren(
    el('div', { class: 'caravan__head' }, title, progress, hardLabel, stopButton),
    cargoList,
    feedback,
    summary,
    el('div', { class: 'caravan__actions' }, cardButton, keys, note),
  );

  pick.append(el('option', { value: '' }, 'Bir yer seç…'));
  [...labels].sort((a, b) => a.label.localeCompare(b.label, 'tr')).forEach((a) => pick.append(el('option', { value: a.id }, a.label)));

  // ------------------------------------------------------------ map layers

  const toLatLng = (p) => view.redrawPixelToLatLng(p.x, p.y);

  function createLayers() {
    const group = L.layerGroup().addTo(map);
    const route = L.polyline([], { className: 'caravan-route', color: '#8f2d20', weight: 3, dashArray: '7 7', interactive: false }).addTo(group);
    const icon = L.divIcon({ className: 'caravan-marker', html: '<span class="caravan-marker__dot"></span>', iconSize: [30, 30], iconAnchor: [15, 15] });
    const marker = L.marker(toLatLng(position), { icon, interactive: false, keyboard: false }).addTo(group);
    const reveal = L.layerGroup().addTo(group);
    return { group, route, marker, reveal };
  }

  function removeLayers() {
    if (layers) map.removeLayer(layers.group);
    layers = null;
  }

  function outline(stop) {
    layers.reveal.clearLayers();
    stop.shapes.forEach((s) => {
      const corners = s.points ?? [[s.minX, s.minY], [s.maxX, s.minY], [s.maxX, s.maxY], [s.minX, s.maxY]];
      L.polygon(corners.map(([x, y]) => toLatLng({ x, y })), { className: 'caravan-reveal', color: '#c2a24e', weight: 3, fillOpacity: 0.15, interactive: false }).addTo(layers.reveal);
    });
  }

  // ---------------------------------------------------------------- render

  const current = () => cargo.find((s) => s.id === selectedId) ?? null;
  const nameOf = (stop) => (hideNames ? 'Aradığın yer' : stop.label);

  function renderCargo() {
    cargoList.replaceChildren();
    for (const stop of cargo) {
      const pressed = stop.id === selectedId;
      const button = el('button', { type: 'button', class: 'caravan__item', 'aria-pressed': String(pressed), 'data-stop': stop.id },
        el('span', { class: 'caravan__name' }, hideNames ? '? ? ?' : stop.label),
        el('span', { class: 'caravan__kind' }, ANNOTATION_KIND[stop.kind] ?? ''),
        el('span', { class: 'caravan__clue' }, stop.clue),
      );
      button.addEventListener('click', () => select(stop.id));
      cargoList.append(el('li', {}, button));
    }
  }

  function renderProgress() {
    progress.textContent = `Teslim ${delivered.length} / ${journeyLength} · İlk denemede ${firstTry} ★`;
  }

  function select(id) {
    selectedId = id;
    attempts = 0;
    cardButton.hidden = true;
    layers?.reveal.clearLayers();
    renderCargo();
    const stop = current();
    if (stop) feedback.textContent = `${nameOf(stop)} seçildi. Haritada yerini bul.`;
  }

  // ----------------------------------------------------------------- rules

  function hitsStop(stop, point, radius) {
    return stop.shapes.some((s) => s.contains(point.x, point.y)
      || (point.x >= s.minX - radius && point.x <= s.maxX + radius && point.y >= s.minY - radius && point.y <= s.maxY + radius));
  }

  function labelAt(point, radius) {
    const hits = labels.filter((a) => a.shapes.some((s) => point.x >= s.minX - radius && point.x <= s.maxX + radius && point.y >= s.minY - radius && point.y <= s.maxY + radius));
    hits.sort((a, b) => a.shapes[0].size - b.shapes[0].size);
    return hits[0] ?? null;
  }

  function judge(point, radius, pickedId = null) {
    const stop = current();
    if (!running || !stop) return null;
    const right = pickedId ? pickedId === stop.id : hitsStop(stop, point, radius);
    if (right) {
      deliver(stop);
      return true;
    }
    attempts += 1;
    const there = pickedId ? labels.find((a) => a.id === pickedId) : labelAt(point, radius);
    const thereText = there ? `Burası “${there.label}”.` : 'Burada aradığın yazı yok.';
    if (attempts === 1 && compass) {
      const from = there ? shapeCenter(there.shapes) : point;
      feedback.textContent = `${thereText} ${nameOf(stop)}, buranın ${directionWord(compassBearing(compass, from, stop.center))} yönünde. Yönleri haritanın kenarındaki Doğu, Kuzey, Batı ve Güney yazılarına göre oku.`;
    } else {
      outline(stop);
      addToList(REVIEW_KEY, stop.id);
      cardButton.hidden = false;
      feedback.textContent = `${thereText} Yeri haritada altın çerçeveyle gösterdim; çerçevenin içine tıklayarak teslim et. Bu yer pekiştirme listene eklendi.`;
    }
    return false;
  }

  function deliver(stop) {
    if (attempts === 0) firstTry += 1;
    delivered.push(stop.id);
    cargo = cargo.filter((s) => s.id !== stop.id);
    position = stop.center;
    addToList(WORDS_KEY, stop.id);
    layers.reveal.clearLayers();
    layers.route.addLatLng(toLatLng(position));
    layers.marker.setLatLng(toLatLng(position));
    if (!map.getBounds().contains(toLatLng(position))) map.panTo(toLatLng(position));
    const onModern = onDelivered(stop);
    const message = `Teslim edildi: ${stop.label}${attempts === 0 ? ' ★' : ''}.${onModern ? ' Araştırmacıların önerdiği günümüz karşılığı sağdaki haritada işaretlendi; yeri yaklaşıktır.' : ''}`;

    if (delivered.length >= journeyLength) {
      finish(message);
      return;
    }
    cargo.push(...pickCargo(stops, usedIds, capacity - cargo.length, random));
    cargo.forEach((s) => usedIds.add(s.id));
    selectedId = null;
    select(cargo[0]?.id ?? null);
    feedback.textContent = `${message} Sıradaki: ${current() ? nameOf(current()) : '—'}.`;
    renderProgress();
  }

  function finish(message) {
    running = false;
    map.getContainer().classList.remove('is-caravan');
    cargo = [];
    renderProgress();
    cargoList.replaceChildren();
    cardButton.hidden = true;
    keys.hidden = true;
    feedback.textContent = message;
    stopButton.textContent = 'Kapat';
    const again = el('button', { type: 'button', class: 'btn btn--primary' }, 'Yeni yolculuk');
    const words = el('button', { type: 'button', class: 'btn' }, 'Sözlüğümü aç');
    const review = el('button', { type: 'button', class: 'btn' }, 'Pekiştirme testini çöz');
    again.addEventListener('click', startGame);
    words.addEventListener('click', () => onOpenWords());
    review.addEventListener('click', () => onOpenReview());
    summary.replaceChildren(
      el('p', { class: 'caravan__result' }, `Yolculuk bitti: ${delivered.length} teslim, ${firstTry} tanesi ilk denemede.`),
      el('p', {}, 'Kervanın rotası haritada kesikli kırmızı çizgiyle gösteriliyor. Teslim ettiğin yer adları Sözlüğüm\'e eklendi; yalnızca bu cihazda saklanır.'),
      el('div', { class: 'caravan__buttons' }, again, words, review),
    );
    summary.hidden = false;
    if (layers) map.fitBounds(layers.route.getBounds().pad(0.15), { maxZoom: map.getZoom() });
    onEnd({ finished: true });
    again.focus();
  }

  // ---------------------------------------------------------------- public

  function startGame() {
    if (!start || stops.length === 0) {
      bar.hidden = false;
      feedback.textContent = 'Oyun verisi bulunamadı.';
      return false;
    }
    removeLayers();
    running = true;
    map.getContainer().classList.add('is-caravan');
    delivered = [];
    firstTry = 0;
    usedIds = new Set();
    position = start.center;
    cargo = pickCargo(stops, usedIds, capacity, random);
    cargo.forEach((s) => usedIds.add(s.id));
    summary.hidden = true;
    keys.hidden = false;
    stopButton.textContent = 'Yolculuğu bitir';
    bar.hidden = false;
    onStart();
    layers = createLayers();
    layers.route.addLatLng(toLatLng(position));
    selectedId = null;
    select(cargo[0].id);
    renderProgress();
    feedback.textContent = `Kervan ${start.label}'dan yola çıkıyor. Kervandan bir ${hideNames ? 'ipucu' : 'kelime'} seç, sonra haritada o yerin yazısına tıkla. İlk yük: ${nameOf(current())}.`;
    cargoList.querySelector('button')?.focus();
    return true;
  }

  function stopGame() {
    const wasRunning = running;
    running = false;
    map.getContainer().classList.remove('is-caravan');
    removeLayers();
    bar.hidden = true;
    if (wasRunning) onEnd({ finished: false });
  }

  map.on('click', (event) => {
    if (!running) return;
    const point = view.latLngToRedrawPixel(event.latlng);
    const edge = view.latLngToRedrawPixel(map.containerPointToLatLng(event.containerPoint.add([CLICK_TOLERANCE_PX, 0])));
    judge(point, Math.abs(edge.x - point.x));
  });
  pickButton.addEventListener('click', () => {
    if (!pick.value) {
      feedback.textContent = 'Önce listeden bir yer seç.';
      return;
    }
    const picked = labels.find((a) => a.id === pick.value);
    judge(shapeCenter(picked.shapes), 0, picked.id);
  });
  cardButton.addEventListener('click', () => { if (current()) onOpenCard(current().id); });
  hardInput.addEventListener('change', () => {
    hideNames = hardInput.checked;
    renderCargo();
    renderProgress();
  });
  stopButton.addEventListener('click', stopGame);

  return {
    stops,
    start: startGame,
    stop: stopGame,
    isRunning: () => running,
    isOpen: () => !bar.hidden,
    /** For tests: the names in the caravan and the current one. */
    state: () => ({ cargo: cargo.map((s) => s.id), selectedId, delivered: [...delivered], firstTry, attempts }),
  };
}
