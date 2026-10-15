#!/usr/bin/env node
/**
 * Validates the JSON data files of the app.
 *
 * Usage: node tools/validate-data.mjs
 * Exit code is 1 when at least one error is found.
 *
 * Rules worth knowing:
 *  - Demo records must be flagged (is_demo) and use confidence "demo".
 *  - Real records must cite at least one known source and may not use "demo".
 *  - location_type decides which coordinates are required.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CATEGORIES = ['place', 'group', 'geography', 'route'];
const FEATURE_TYPES = ['mountain', 'river', 'lake', 'sea', 'desert', 'other', null];
const LOCATION_TYPES = ['precise', 'approximate', 'disputed', 'schematic'];
const CONFIDENCE = ['high', 'medium', 'low', 'demo'];

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

async function readJson(rel) {
  const text = await readFile(path.join(ROOT, rel), 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    fail(`${rel}: invalid JSON (${e.message})`);
    return null;
  }
}

const isLatLng = (v) =>
  Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) &&
  Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;

const isXY = (v, w, h) =>
  Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) &&
  v[0] >= 0 && v[0] <= w && v[1] >= 0 && v[1] <= h;

function validateRecord(r, i, ctx) {
  const where = `places.json record #${i} (${r.id ?? 'no id'})`;
  for (const key of ['id', 'historical_name', 'category', 'description', 'location_type', 'confidence', 'last_updated']) {
    if (r[key] === undefined || r[key] === null || r[key] === '') fail(`${where}: missing "${key}"`);
  }
  if (typeof r.is_demo !== 'boolean') fail(`${where}: "is_demo" must be true or false`);
  if (!CATEGORIES.includes(r.category)) fail(`${where}: bad category "${r.category}"`);
  if (!FEATURE_TYPES.includes(r.feature_type ?? null)) fail(`${where}: bad feature_type "${r.feature_type}"`);
  if (!LOCATION_TYPES.includes(r.location_type)) fail(`${where}: bad location_type "${r.location_type}"`);
  if (!CONFIDENCE.includes(r.confidence)) fail(`${where}: bad confidence "${r.confidence}"`);
  if (!Array.isArray(r.alt_spellings)) fail(`${where}: "alt_spellings" must be an array`);
  if (!Array.isArray(r.sources)) fail(`${where}: "sources" must be an array`);

  if (ctx.ids.has(r.id)) fail(`${where}: duplicate id`);
  ctx.ids.add(r.id);

  // Demo vs real
  if (r.is_demo && r.confidence !== 'demo') fail(`${where}: demo record must use confidence "demo"`);
  if (!r.is_demo && r.confidence === 'demo') fail(`${where}: real record cannot use confidence "demo"`);
  if (!r.is_demo && (!Array.isArray(r.sources) || r.sources.length === 0)) {
    fail(`${where}: real record needs at least one source`);
  }

  // Source references
  for (const s of r.sources ?? []) {
    if (!ctx.sourceIds.has(s.source_id)) fail(`${where}: unknown source_id "${s.source_id}"`);
    if (!s.locator) warn(`${where}: source "${s.source_id}" has no locator (page or section)`);
  }

  // Coordinates
  const hasLatLng = r.lat_lng !== null && r.lat_lng !== undefined;
  const hasXY = r.schematic_xy !== null && r.schematic_xy !== undefined;
  if (hasLatLng && !isLatLng(r.lat_lng)) fail(`${where}: lat_lng must be [lat, lng] within range`);
  if (hasXY && !isXY(r.schematic_xy, ctx.width, ctx.height)) {
    fail(`${where}: schematic_xy must be [x, y] inside 0..${ctx.width} x 0..${ctx.height}`);
  }
  if (!hasLatLng && !hasXY) fail(`${where}: needs lat_lng or schematic_xy`);
  if (r.location_type === 'schematic' && !hasXY) fail(`${where}: "schematic" records need schematic_xy`);
  if (['precise', 'approximate', 'disputed'].includes(r.location_type) && !hasLatLng) {
    fail(`${where}: "${r.location_type}" records need lat_lng`);
  }
  if (['approximate', 'disputed'].includes(r.location_type)) {
    if (!(Number.isFinite(r.uncertainty_radius_km) && r.uncertainty_radius_km > 0)) {
      fail(`${where}: "${r.location_type}" records need a positive uncertainty_radius_km`);
    }
  }
  if (r.location_type === 'precise' && r.confidence === 'low') {
    warn(`${where}: "precise" with low confidence is contradictory; consider "approximate"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.last_updated ?? '')) fail(`${where}: last_updated must be YYYY-MM-DD`);
}

function validateQuiz(quiz) {
  if (!quiz) return;
  const seen = new Set();
  for (const q of quiz.questions ?? []) {
    const where = `quiz.json question ${q.id}`;
    if (seen.has(q.id)) fail(`${where}: duplicate id`);
    seen.add(q.id);
    const optionIds = (q.options ?? []).map((o) => o.id);
    if (optionIds.length < 2) fail(`${where}: needs at least 2 options`);
    if (new Set(optionIds).size !== optionIds.length) fail(`${where}: duplicate option ids`);
    if (!optionIds.includes(q.correct)) fail(`${where}: "correct" does not match any option`);
    if (!q.explanation) fail(`${where}: missing explanation`);
  }
  if (!(quiz.questions ?? []).length) fail('quiz.json: no questions');
}

function validateInstruments(instruments) {
  if (!instruments) return;
  for (const [formId, form] of Object.entries(instruments.forms ?? {})) {
    for (const item of form.items ?? []) {
      const ids = (item.options ?? []).map((o) => o.id);
      if (!ids.includes(item.correct)) fail(`research-instruments.json form ${formId} item ${item.id}: "correct" does not match an option`);
    }
  }
  if (Object.keys(instruments.forms ?? {}).sort().join() !== 'A,B') fail('research-instruments.json: forms A and B are required');
  if ((instruments.forms?.A?.items ?? []).length !== (instruments.forms?.B?.items ?? []).length) fail('research-instruments.json: forms A and B must have the same number of items');
  if (!(instruments.survey?.items ?? []).length) fail('research-instruments.json: survey has no items');
}

function validateEquivalents(data, sourceIds) {
  if (!data) return;
  const statuses = ['agreed', 'single', 'tentative', 'disputed', 'unidentified'];
  const seen = new Set();
  for (const r of data.records ?? []) {
    const where = `modern-equivalents.json ${r.id}`;
    if (seen.has(r.id)) fail(`${where}: duplicate id`);
    seen.add(r.id);
    if (!statuses.includes(r.status)) fail(`${where}: unknown status "${r.status}"`);
    if (!(r.sources ?? []).length) fail(`${where}: needs at least one source`);
    for (const s of r.sources ?? []) {
      if (!sourceIds.has(s.source_id)) fail(`${where}: unknown source "${s.source_id}"`);
      if (!s.locator) fail(`${where}: source without locator`);
    }
    if (r.status === 'agreed' && (r.sources ?? []).length < 2) fail(`${where}: "agreed" needs at least two sources`);
    if ('lat_lng' in r || 'schematic_xy' in r) fail(`${where}: equivalents must not carry coordinates`);
  }
}


const ANNOTATION_STATUSES = new Set(['sourced', 'partial', 'interpretation', 'label-only']);
const ANNOTATION_KINDS = new Set(['place', 'region', 'river', 'water', 'steppe', 'mountain', 'legend', 'direction', 'note', 'line', 'symbol', 'area']);
const ANNOTATION_LAYERS = new Set(['label', 'shape', 'area']);

/** Explanation cards of the redraw map (data/map-annotations.json). */
function validateAnnotations(data, sourceIds, equivalentIds, redraw) {
  if (!data) return;
  const { width, height } = data.coordinateSpace ?? {};
  if (!redraw || width !== redraw.width || height !== redraw.height) fail('map-annotations.json: coordinateSpace must equal config.redrawMap width and height');
  const checkCard = (card, where, { needsStatus = true } = {}) => {
    if (!card.paragraphs || !Array.isArray(card.paragraphs)) fail(`${where}: "paragraphs" must be an array`);
    if (needsStatus && !ANNOTATION_STATUSES.has(card.status)) fail(`${where}: unknown status "${card.status}"`);
    if (card.status === 'label-only' && (card.sources ?? []).length) fail(`${where}: a label-only card must not list sources`);
    if (['sourced', 'partial'].includes(card.status) && !(card.sources ?? []).length && card.status === 'sourced') fail(`${where}: a "sourced" card needs at least one source`);
    if (card.status === 'label-only' && (card.paragraphs ?? []).some((p) => /\bkaynak(ta|lara|lar)? (göre|belirt)/i.test(p))) fail(`${where}: a label-only card must not claim a source`);
    for (const ref of card.sources ?? []) {
      if (!sourceIds.has(ref.source_id)) fail(`${where}: unknown source "${ref.source_id}"`);
      if (!ref.locator) fail(`${where}: source without locator`);
    }
  };
  for (const [id, card] of Object.entries(data.classes ?? {})) {
    if (!card.title) fail(`map-annotations.json: class "${id}" has no title`);
    checkCard(card, `map-annotations.json class "${id}"`);
  }
  for (const needed of ['mountain-line', 'river-line', 'sea-fill', 'settlement-dot', 'sand-fill', 'dotted-line', 'ocean-ring', 'empty-land', 'outside']) {
    if (!data.classes?.[needed]) fail(`map-annotations.json: missing class "${needed}"`);
  }
  const ids = new Set();
  (data.annotations ?? []).forEach((a, i) => {
    const where = `map-annotations.json annotation #${i + 1} (${a.id ?? '?'})`;
    if (!a.id || ids.has(a.id)) fail(`${where}: missing or duplicate id`);
    ids.add(a.id);
    if (!a.label) fail(`${where}: no label`);
    if (!ANNOTATION_KINDS.has(a.kind)) fail(`${where}: unknown kind "${a.kind}"`);
    if (!ANNOTATION_LAYERS.has(a.layer)) fail(`${where}: unknown layer "${a.layer}"`);
    if (!Array.isArray(a.areas) || a.areas.length === 0) fail(`${where}: needs at least one area`);
    for (const area of a.areas ?? []) {
      const points = Array.isArray(area) ? [[area[0], area[1]], [area[0] + area[2], area[1] + area[3]]] : area.poly;
      if (!points || (Array.isArray(area) && area.length !== 4) || (!Array.isArray(area) && points.length < 3)) fail(`${where}: bad area ${JSON.stringify(area).slice(0, 50)}`);
      for (const [x, y] of points ?? []) {
        if (!(x >= 0 && x <= width && y >= 0 && y <= height)) fail(`${where}: area outside the image (${x}, ${y})`);
      }
    }
    checkCard(a, where);
    if (a.equivalentId && !equivalentIds.has(a.equivalentId)) fail(`${where}: unknown equivalentId "${a.equivalentId}"`);
  });
}

const GEO_TYPES = new Set(['box', 'circle', 'line', 'lines']);

/** Shapes of the findings on the modern map (data/modern-geo.json). */
function validateGeo(geo, equivalents) {
  if (!geo) return;
  const equivalentById = new Map((equivalents?.records ?? []).map((r) => [r.id, r]));
  const groups = new Set(Object.keys(geo.groups ?? {}));
  if (!geo.geometryNote || !geo.notice) fail('modern-geo.json: "notice" and "geometryNote" are required (shapes must be described as approximate)');
  const seen = new Set();
  const point = (p, where) => { if (!isLatLng(p)) fail(`${where}: bad [lat, lng] ${JSON.stringify(p)}`); };
  for (const f of geo.features ?? []) {
    const where = `modern-geo.json ${f.equivalentId}`;
    const record = equivalentById.get(f.equivalentId);
    if (!record) { fail(`${where}: unknown equivalentId`); continue; }
    if (seen.has(f.equivalentId)) fail(`${where}: duplicate feature`);
    seen.add(f.equivalentId);
    if (record.status === 'unidentified') fail(`${where}: an unidentified place must not be drawn`);
    if (!groups.has(f.group)) fail(`${where}: unknown group "${f.group}"`);
    if (!f.label) fail(`${where}: no label`);
    if (!f.geometryNote) fail(`${where}: geometryNote is required (say what the shape is and is not)`);
    const g = f.geometry ?? {};
    if (!GEO_TYPES.has(g.type)) { fail(`${where}: unknown geometry type "${g.type}"`); continue; }
    if (g.type === 'box') { if (!Array.isArray(g.bounds) || g.bounds.length !== 2) fail(`${where}: box needs two corners`); else g.bounds.forEach((p) => point(p, where)); }
    if (g.type === 'circle') { point(g.center, where); if (!(g.radius_km > 0)) fail(`${where}: circle needs a positive radius_km`); }
    if (g.type === 'line') { if ((g.points ?? []).length < 2) fail(`${where}: line needs at least two points`); (g.points ?? []).forEach((p) => point(p, where)); }
    if (g.type === 'lines') { if (!(g.lines ?? []).length) fail(`${where}: lines needs at least one line`); (g.lines ?? []).flat().forEach((p) => point(p, where)); }
  }
  for (const id of Object.keys(geo.notPlotted ?? {})) {
    if (!equivalentById.has(id)) fail(`modern-geo.json notPlotted: unknown id "${id}"`);
    if (seen.has(id)) fail(`modern-geo.json: "${id}" is both drawn and listed as not drawn`);
  }
  for (const r of equivalents?.records ?? []) {
    if (!seen.has(r.id) && !(r.id in (geo.notPlotted ?? {}))) warn(`modern-geo.json: equivalent "${r.id}" is neither drawn nor listed as not drawn`);
  }
}

/** The caravan game (data/caravan.json): every stop must be a sourced card, and a clue must not give the name away. */
function validateCaravan(caravan, annotations) {
  if (!caravan) return;
  const byId = new Map((annotations?.annotations ?? []).map((a) => [a.id, a]));
  const fold = (t) => String(t ?? '').toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
  const GENERIC = new Set(['irmagi', 'ulkesi', 'diyari', 'diyarlari', 'dagi', 'denizi', 'sehri', 'meskeni', 've', 'bu', 'endulus\'tur']);
  if (!byId.has(caravan.start)) fail(`caravan.json: start "${caravan.start}" is not a card of map-annotations.json`);
  if (caravan.reviewed !== true && !/gözden geçirilmedi/.test(caravan.notice ?? '')) fail('caravan.json: unreviewed clues must say so in the notice');
  const seen = new Set();
  (caravan.stops ?? []).forEach((stop, i) => {
    const where = `caravan.json stop #${i + 1} (${stop.id ?? '?'})`;
    const card = byId.get(stop.id);
    if (!card) return fail(`${where}: no such card in map-annotations.json`);
    if (seen.has(stop.id)) fail(`${where}: duplicate stop`);
    seen.add(stop.id);
    if (!['sourced', 'partial'].includes(card.status)) fail(`${where}: the card is "${card.status}"; only sourced or partial cards can be stops`);
    if (!stop.clue || stop.clue.length < 15) fail(`${where}: clue missing or too short`);
    const clue = fold(stop.clue);
    for (const word of fold(card.label).split(/[\s:]+/).filter((w) => w.length > 2 && !GENERIC.has(w))) {
      if (clue.includes(word)) fail(`${where}: the clue contains the name ("${word}")`);
    }
  });
  if ((caravan.stops ?? []).length < (caravan.journeyLength ?? 8)) fail('caravan.json: fewer stops than journeyLength');
}

/** The game page (data/game.json): fiction must say it is fiction, questions must rest on sourced map classes. */
function validateGame(game, annotations, sourceIds) {
  if (!game) return;
  const who = new Set(Object.keys(game.characters ?? {}));
  const classes = annotations?.classes ?? {};
  if (!/kurgu/.test(game.notice ?? '')) fail('game.json: the notice must say that characters and events are fiction ("kurgu")');
  for (const [key, c] of Object.entries(game.characters ?? {})) {
    if (!c.name || !c.initial || !/^#[0-9a-f]{6}$/i.test(c.color ?? '')) fail(`game.json character "${key}": name, initial and a #rrggbb colour are required`);
  }
  const lines = Object.entries(game.lines ?? {}).flatMap(([key, v]) => (Array.isArray(v) ? v.map((l, i) => [`${key}[${i}]`, l]) : [[key, v]]));
  for (const [key, line] of lines) {
    if (!who.has(line.who) || !line.text) fail(`game.json line "${key}": unknown speaker or empty text`);
  }
  for (const needed of ['pick', 'wrongFirst', 'wrongSecond', 'travel', 'arrive', 'refillCity', 'refillWater', 'equivalent', 'thirsty', 'finish']) {
    if (!game.lines?.[needed]) fail(`game.json: missing line "${needed}"`);
  }
  for (const e of game.events ?? []) {
    const where = `game.json event "${e.id}"`;
    if (!e.title || !e.text || !who.has(e.who)) fail(`${where}: title, text and a known speaker are required`);
    if (![null, 'map', 'direction', 'place'].includes(e.question ?? null)) fail(`${where}: unknown question type "${e.question}"`);
    if (!e.right?.text || (e.question && !e.wrong?.text)) fail(`${where}: outcome texts are required`);
  }
  if (!(game.mapQuestions ?? []).length) fail('game.json: at least one map-reading question is required');
  for (const q of game.mapQuestions ?? []) {
    const where = `game.json map question "${q.id}"`;
    const cls = classes[q.classId];
    if (!cls) fail(`${where}: unknown classId "${q.classId}"`);
    else if (!['sourced', 'partial'].includes(cls.status)) fail(`${where}: class "${q.classId}" is not backed by a source`);
    if (!q.prompt || !q.answer || !q.explanation) fail(`${where}: prompt, answer and explanation are required`);
    if (!Array.isArray(q.wrong) || q.wrong.length < 3 || q.wrong.includes(q.answer)) fail(`${where}: three wrong options, none equal to the answer`);
  }
  for (const w of game.divanWords ?? []) {
    const where = `game.json Dîvân word "${w.word ?? '?'}"`;
    if (!w.word || !w.meaning) fail(`${where}: word and meaning are required`);
    if (!(w.sources ?? []).length || w.sources.some((s) => !sourceIds.has(s.source_id) || !s.locator)) fail(`${where}: every word needs a known source with a page or section`);
  }
  if (game.story && (!game.story.title || !(game.story.questions ?? []).length || !/kişisel/.test(game.story.privacy ?? ''))) fail('game.json: the story section needs a title, questions and a privacy note about personal data');
  const s = game.settings ?? {};
  if (!(s.journeyLength > 0 && s.capacity > 0 && s.waterStart > 0 && s.waterMax >= s.waterStart && s.pixelsPerWater > 0)) fail('game.json: settings are incomplete or inconsistent');
}

async function main() {
  const [config, places, sources, quiz, instruments, equivalents, annotations, geo, caravan, game] = await Promise.all([
    readJson('data/config.json'),
    readJson('data/places.json'),
    readJson('data/sources.json'),
    readJson('data/quiz.json'),
    readJson('data/research-instruments.json'),
    readJson('data/modern-equivalents.json'),
    readJson('data/map-annotations.json'),
    readJson('data/modern-geo.json'),
    readJson('data/caravan.json'),
    readJson('data/game.json'),
  ]);
  if (!config || !places || !sources) return finish();

  if (!(config.originalMap?.width > 0 && config.originalMap?.height > 0)) {
    fail('config.json: originalMap.width and height must be positive numbers');
  }
  if (config.redrawMap && config.redrawMap.provenanceVerified === false && !config.redrawMap.credit) {
    fail('config.json: the redraw map is unverified, so its credit line must say so');
  }
  if (config.originalMap?.imagePath && !config.originalMap.licenseVerified) {
    fail('config.json: an original map image is set but licenseVerified is false');
  }

  const sourceIds = new Set();
  for (const s of sources.sources ?? []) {
    if (!s.id || !s.title) fail(`sources.json: entry without id or title (${JSON.stringify(s).slice(0, 60)})`);
    if (sourceIds.has(s.id)) fail(`sources.json: duplicate id "${s.id}"`);
    sourceIds.add(s.id);
    if (s.citation_verified === false) warn(`sources.json: "${s.id}" citation not yet verified`);
  }

  const ctx = {
    ids: new Set(),
    sourceIds,
    width: config.originalMap?.width ?? 1000,
    height: config.originalMap?.height ?? 700,
  };
  (places.records ?? []).forEach((r, i) => validateRecord(r, i, ctx));
  validateQuiz(quiz);
  validateInstruments(instruments);
  validateEquivalents(equivalents, sourceIds);
  validateGeo(geo, equivalents);
  validateAnnotations(annotations, sourceIds, new Set((equivalents?.records ?? []).map((r) => r.id)), config.redrawMap);
  validateCaravan(caravan, annotations);
  validateGame(game, annotations, sourceIds);
  finish(places.records?.length ?? 0);
}

function finish(count = 0) {
  for (const w of warnings) console.log(`WARN  ${w}`);
  for (const e of errors) console.log(`ERROR ${e}`);
  console.log(`\n${count} record(s) checked: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
