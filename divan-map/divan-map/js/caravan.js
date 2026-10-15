/**
 * Shared parts of "Kâşgarlı'nın Kervanı" (the game itself is game.html, js/game.js).
 *
 * Places of the game ("stops") come from data/caravan.json joined with the explanation cards: each has a
 * clue taken from its card. This module builds the stops, reads the map's own compass, draws cargo, builds
 * the review quiz and renders "Sözlüğüm" on the main page. Delivered names and places to review are kept on
 * this device only (storage.js). All text comes from data files and is added with textContent only.
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
