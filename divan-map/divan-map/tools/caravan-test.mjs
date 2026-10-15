/**
 * Tests the rules of "Kâşgarlı'nın Kervanı" (js/caravan.js) with the real data files: which cards become stops,
 * the map's own compass (read from its direction labels), the cargo draw and the review quiz. The game on the map is
 * checked in tools/smoke-test.mjs. Run with `node tools/caravan-test.mjs` (also part of `npm test`).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const bundle = buildSync({ entryPoints: [path.join(ROOT, 'js/caravan.js')], bundle: true, format: 'iife', globalName: 'Caravan', write: false, logLevel: 'warning' }).outputFiles[0].text;
const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:8000/', runScripts: 'outside-only' });
window.matchMedia = () => ({ matches: false });
window.eval(bundle);
const C = window.Caravan;

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};

// the annotations as explain.js prepares them (rectangles only are enough here)
const raw = json('data/map-annotations.json').annotations;
const rect = ([x, y, w, h]) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h, size: w * h, contains: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h });
const annotations = raw.map((a) => ({ ...a, shapes: a.areas.map((area) => (Array.isArray(area) ? rect(area) : rect([0, 0, 1, 1]))) }));
const caravan = json('data/caravan.json');
const circle = json('data/config.json').redrawMap.circle;

// stops
const { start, stops } = C.buildStops(caravan, annotations);
check('the journey starts at Kaşgar', start?.id === 'kasgar');
check('every stop of the data file is playable', stops.length === caravan.stops.length);
check('only cards backed by a source become stops', stops.every((s) => ['sourced', 'partial'].includes(s.status)));
const fake = C.buildStops({ start: 'kasgar', stops: [{ id: 'macin', clue: 'Bir ipucu cümlesi buraya.' }, { id: 'nope', clue: 'Bir ipucu cümlesi buraya.' }] }, annotations);
check('label-only and unknown cards are left out', fake.stops.length === 0);

// compass: read from the map's own direction labels, not from the screen
const compass = C.buildCompass(annotations, circle);
const centre = { x: circle.cx, y: circle.cy };
const towards = (id) => C.shapeCenter(annotations.find((a) => a.id === id).shapes);
check('the compass is read from the four direction labels', Array.isArray(compass) && compass.length === 4);
check('towards the "Doğu" label is east', C.directionWord(C.compassBearing(compass, centre, towards('dogu'))) === 'doğu');
check('towards the "Kuzey" label is north', C.directionWord(C.compassBearing(compass, centre, towards('kuzey'))) === 'kuzey');
check('towards the "Batı" label is west', C.directionWord(C.compassBearing(compass, centre, towards('bati'))) === 'batı');
check('towards the "Güney" label is south', C.directionWord(C.compassBearing(compass, centre, towards('guney'))) === 'güney');
const up = C.directionWord(C.compassBearing(compass, centre, { x: centre.x, y: centre.y - 100 }));
check('straight up on the screen is between north and east on this map', ['kuzeydoğu', 'doğu', 'kuzey'].includes(up));

// cargo
let seed = 7;
const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const cargo = C.pickCargo(stops, new Set(['balasagun']), 3, random);
check('the caravan takes three different names', cargo.length === 3 && new Set(cargo.map((s) => s.id)).size === 3);
check('names already used are not drawn again', !cargo.some((s) => s.id === 'balasagun'));
check('the draw stops when the pool is empty', C.pickCargo(stops.slice(0, 2), new Set(), 5, random).length === 2);

// review quiz
const quiz = C.buildReviewQuiz(stops, ['hoten', 'hoten', 'unknown', 'cabarka'], 5, random);
check('the review quiz has five questions', quiz.questions.length === 5);
check('places on the review list come first', quiz.questions[0].stopId === 'hoten' && quiz.questions[1].stopId === 'cabarka');
check('every question has four different options and one right answer', quiz.questions.every((q) => q.options.length === 4 && new Set(q.options.map((o) => o.text)).size === 4 && q.options.some((o) => o.id === q.correct)));
check('the right option is the place of the clue', quiz.questions.every((q) => q.options.find((o) => o.id === q.correct).text === stops.find((s) => s.id === q.stopId).label));
check('the quiz has the shape of data/quiz.json', quiz.questions.every((q) => q.id && q.prompt && q.explanation));

// local lists
window.localStorage.setItem('dlt:caravanReview', JSON.stringify(['hoten', 'cabarka']));
C.forgetReview('hoten');
check('a right answer removes the place from the review list', window.localStorage.getItem('dlt:caravanReview') === JSON.stringify(['cabarka']));
const box = window.document.createElement('div');
check('an empty "Sözlüğüm" invites to play', C.renderWordsList(box, stops, { onShow: () => {} }) === 0 && box.textContent.includes('Henüz'));
window.localStorage.setItem('dlt:caravanWords', JSON.stringify(['hoten', 'cabarka', 'gone']));
let shown = null;
check('"Sözlüğüm" lists the collected names it knows', C.renderWordsList(box, stops, { onShow: (id) => { shown = id; } }) === 2);
check('"Sözlüğüm" marks places still to review', box.textContent.includes('Tekrar edilecek'));
box.querySelector('button').click();
check('"Haritada göster" names the place', shown === 'cabarka');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll caravan checks passed');
process.exit(failed ? 1 : 0);
