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

async function main() {
  const [config, places, sources, quiz, instruments, equivalents] = await Promise.all([
    readJson('data/config.json'),
    readJson('data/places.json'),
    readJson('data/sources.json'),
    readJson('data/quiz.json'),
    readJson('data/research-instruments.json'),
    readJson('data/modern-equivalents.json'),
  ]);
  if (!config || !places || !sources) return finish();

  if (!(config.originalMap?.width > 0 && config.originalMap?.height > 0)) {
    fail('config.json: originalMap.width and height must be positive numbers');
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
