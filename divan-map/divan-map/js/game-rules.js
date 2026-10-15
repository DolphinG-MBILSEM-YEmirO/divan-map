/**
 * Rules of the caravan game page (game.html), kept free of the DOM and of Leaflet so they can be tested.
 *
 * Coordinates are pixels of the Turkish-labelled redraw (config.redrawMap). Place data come from
 * data/caravan.json + data/map-annotations.json (through caravan.js); everything else the game says
 * (characters, events, map-reading questions) comes from data/game.json.
 */
import { buildReviewQuiz, compassBearing, directionWord, shapeCenter } from './caravan.js';

export const DIRECTIONS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];

/** Rectangles [x, y, w, h] and polygons { poly } of an annotation, with bounds and a point test. */
export function makeShape(area) {
  if (Array.isArray(area)) {
    const [x, y, w, h] = area;
    return { minX: x, minY: y, maxX: x + w, maxY: y + h, size: w * h, contains: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h };
  }
  const pts = area.poly;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    points: pts, minX, minY, maxX, maxY, size: (maxX - minX) * (maxY - minY),
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

/** The annotations of data/map-annotations.json with prepared shapes (same form as explain.js uses). */
export function prepareAnnotations(raw) {
  return raw.map((a) => ({ ...a, shapes: a.areas.map(makeShape) }));
}

/** Fills "{name}" placeholders of a line of data/game.json. */
export function fill(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => (values[key] ?? '').toString());
}

export const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Water a leg costs: one unit per `pixelsPerWater` image pixels, at least one. */
export function travelCost(from, to, pixelsPerWater = 380) {
  return Math.max(1, Math.round(distance(from, to) / pixelsPerWater));
}

/** Water gained on arrival: cities and rivers refill (a game rule, not history). */
export function refillFor(kind, settings) {
  return settings?.refillByKind?.[kind] ?? 0;
}

export const clampWater = (value, max) => Math.max(0, Math.min(max, value));

/** True when the point is on (or within `radius` of) one of the stop's areas. */
export function hits(stop, point, radius = 0) {
  return stop.shapes.some((s) => s.contains(point.x, point.y)
    || (point.x >= s.minX - radius && point.x <= s.maxX + radius && point.y >= s.minY - radius && point.y <= s.maxY + radius));
}

/** The smallest written label at a point, if any (to tell the player what they clicked). */
export function labelAt(labels, point, radius = 0) {
  const found = labels.filter((a) => a.shapes.some((s) => point.x >= s.minX - radius && point.x <= s.maxX + radius && point.y >= s.minY - radius && point.y <= s.maxY + radius));
  found.sort((a, b) => a.shapes[0].size - b.shapes[0].size);
  return found[0] ?? null;
}

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function asQuestion(kind, prompt, answer, wrong, explanation, random) {
  const options = shuffle([answer, ...wrong], random).map((text, i) => ({ id: String.fromCharCode(97 + i), text }));
  return { kind, prompt, options, correct: options.find((o) => o.text === answer).id, explanation };
}

/** A map-reading question from data/game.json (colours, symbols, scale). */
export function buildMapQuestion(entry, random = Math.random) {
  return asQuestion('map', entry.prompt, entry.answer, entry.wrong.slice(0, 3), entry.explanation, random);
}

/** "Which way is X from here?" read with the map's own compass labels. */
export function buildDirectionQuestion(compass, from, to, toName, random = Math.random) {
  const answer = directionWord(compassBearing(compass, from, to));
  const index = DIRECTIONS.indexOf(answer);
  // Wrong options: the opposite and the two side directions, so neighbours of the answer are never offered.
  const wrong = [4, 2, 6].map((step) => DIRECTIONS[(index + step) % 8]);
  return asQuestion(
    'direction',
    `Kervan şimdi buradan ${toName} yazısına gidecek. Haritanın yön yazılarına göre ${toName} hangi yönde?`,
    answer,
    wrong,
    `Haritanın kenarındaki Doğu, Kuzey, Batı ve Güney yazılarına göre ${toName} buranın ${answer} yönündedir. Bu haritada üst taraf kuzey değildir.`,
    random,
  );
}

/** "Which place does this clue describe?" from the place clues. */
export function buildPlaceQuestion(stops, stop, random = Math.random) {
  const q = buildReviewQuiz(stops, [stop.id], 1, random).questions[0];
  return { kind: 'place', prompt: q.prompt, options: q.options, correct: q.correct, explanation: q.explanation, stopId: stop.id };
}

/**
 * Picks the event after an arrival, or null. Events whose question cannot be built right now
 * (no next target for a direction question, too few places) are skipped.
 */
export function pickEvent(events, { chance = 0.6, canAskDirection = true, canAskPlace = true } = {}, random = Math.random) {
  if (random() >= chance) return null;
  const usable = events.filter((e) => (e.question !== 'direction' || canAskDirection) && (e.question !== 'place' || canAskPlace));
  return usable.length ? usable[Math.floor(random() * usable.length)] : null;
}

/** Centre point of a stop (re-exported for the page). */
export { shapeCenter };
