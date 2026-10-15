/**
 * Tests the game page (game.html, js/game.js, js/game-rules.js, js/game-board.js) in jsdom: the rules
 * (water, refills, questions, events) and a whole journey played through the keyboard list. Drawing and
 * animation are NOT checked here; see README. Run with `node tools/game-test.mjs` (also part of `npm test`).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const build = (entry, globalName) => buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'iife', globalName, write: false, logLevel: 'warning' }).outputFiles[0].text;

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// ----------------------------------------------------------------- rules
{
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:8000/', runScripts: 'outside-only' });
  window.matchMedia = () => ({ matches: false });
  window.eval(build('js/game-rules.js', 'Rules'));
  const R = window.Rules;
  const game = json('data/game.json');
  let seed = 11;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  check('a short leg costs one water', R.travelCost({ x: 0, y: 0 }, { x: 10, y: 0 }, 380) === 1);
  check('a long leg costs more water', R.travelCost({ x: 0, y: 0 }, { x: 1200, y: 0 }, 380) === 3);
  check('places and rivers refill, regions do not', R.refillFor('place', game.settings) === 1 && R.refillFor('river', game.settings) === 2 && R.refillFor('region', game.settings) === 0);
  check('water never goes below zero or above the limit', R.clampWater(-3, 10) === 0 && R.clampWater(14, 10) === 10);
  check('lines are filled in', R.fill('{to} teslim edildi', { to: 'Hoten' }) === 'Hoten teslim edildi');
  const mq = R.buildMapQuestion(game.mapQuestions[0], random);
  check('a map question has four options and the sourced answer', mq.options.length === 4 && mq.options.find((o) => o.id === mq.correct).text === game.mapQuestions[0].answer);
  const annotations = R.prepareAnnotations(json('data/map-annotations.json').annotations);
  window.eval(build('js/caravan.js', 'Caravan'));
  const compass = window.Caravan.buildCompass(annotations, json('data/config.json').redrawMap.circle);
  const centre = { x: 895, y: 848 };
  const dogu = window.Caravan.shapeCenter(annotations.find((a) => a.id === 'dogu').shapes);
  const dq = R.buildDirectionQuestion(compass, centre, dogu, 'Doğu', random);
  const answer = dq.options.find((o) => o.id === dq.correct).text;
  check('a direction question reads the map’s own compass', answer === 'doğu');
  check('a direction question never offers a neighbour of the answer', !dq.options.some((o) => ['kuzeydoğu', 'güneydoğu'].includes(o.text)));
  check('no event is picked when the dice say so', R.pickEvent(game.events, { chance: 0 }, random) === null);
  check('direction events are skipped when there is no next place', Array.from({ length: 40 }, () => R.pickEvent(game.events, { chance: 1, canAskDirection: false }, random)).every((e) => e.question !== 'direction'));
  const poly = R.makeShape({ poly: [[0, 0], [10, 0], [10, 10], [0, 10]] });
  check('polygon areas are hit-tested', poly.contains(5, 5) && !poly.contains(15, 5));
}

// ------------------------------------------------------------ the page
const html = readFileSync(path.join(ROOT, 'game.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost:8000/game.html', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.matchMedia = (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }); // no animation in tests
window.Element.prototype.scrollIntoView = function () {};
window.fetch = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(path.join(ROOT, url), 'utf8')) });
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));
window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));
window.eval(build('js/game.js', 'Game'));
await tick(300);
const $ = (id) => window.document.getElementById(id);
const G = window.__game;

check('the game page boots without errors', !!G && errors.length === 0);
check('the start screen introduces the fictional characters and says they are fiction', !$('overlay').hidden && ['Kervanbaşı Bilge', 'Kâtip Ayaz', 'Deveci Tarkan'].every((n) => $('overlay').textContent.includes(n)) && $('overlay').textContent.includes('kurgu'));
check('the board shows the Turkish-labelled redraw and its credit', !!window.document.querySelector('#board .leaflet-image-layer') && $('board-credit').textContent.includes('doğrulanmadı'));
$('overlay').querySelector('.g-start').click();
await tick();
check('starting hides the start screen and loads three names', $('overlay').hidden && window.document.querySelectorAll('.g-cargo__item').length === 3);
check('the caravan stands at Kaşgar', !!window.document.querySelector('#board .cv-caravan'));
check('the water meter starts full', $('hud-water').getAttribute('aria-valuenow') === '10');

const first = G.g.selectedId;
const wrong = G.stops.find((s) => s.id !== first && !G.g.cargo.some((c) => c.id === s.id)).id;
const deliverByList = (id) => { $('pick').value = id; $('pick-go').click(); };
deliverByList(wrong);
check('a wrong place gets a direction hint in the map’s compass', /yönünde/.test($('talk').textContent) && G.g.attempts === 1);
deliverByList(wrong);
check('a second wrong try outlines the place and offers its card', !!window.document.querySelector('#board .cv-help') && !!window.document.querySelector('.g-cardtext'));
check('the place goes to the review list', JSON.parse(window.localStorage.getItem('dlt:caravanReview')).includes(first));
deliverByList(first);
await tick();
check('the right place is delivered without a star after help', G.g.delivered[0] === first && G.g.stars === 0);
check('water was used on the way', G.g.water <= 10 && $('hud-delivered').textContent.startsWith('1 /'));
check('a flag marks the delivered place', window.document.querySelectorAll('#board .cv-flag').length === 1);
check('the name is written in the notebook and in Sözlüğüm', $('notebook').textContent.includes(G.stops.find((s) => s.id === first).label) && JSON.parse(window.localStorage.getItem('dlt:caravanWords')).includes(first));

// play the rest of the journey: answer every event with its first option
let guard = 0;
while (G.g.phase !== 'end' && guard < 60) {
  guard += 1;
  if (G.g.phase === 'event') {
    const option = window.document.querySelector('.g-q__option:not([disabled])');
    if (option) option.click();
    check(`event ${guard} is labelled as fiction`, $('task').textContent.includes('kurgu'));
    window.document.querySelector('#task .btn--primary')?.click();
  } else if (G.g.phase === 'choose') {
    deliverByList(G.g.selectedId);
  }
  await tick();
}
check('the journey ends with a summary', G.g.phase === 'end' && !$('overlay').hidden && /teslim/.test($('overlay').textContent));
check('the summary lists every delivered name', $('overlay').querySelectorAll('.g-summary li').length === G.g.delivered.length);
check('a full journey or an empty water skin ends it', G.g.delivered.length === 8 || G.g.water === 0);
check('no script errors during the journey', errors.length === 0);

const story = $('overlay').querySelector('.g-story');
check('the end screen asks the player to tell the journey, with the route and guiding questions', !!story && story.textContent.includes('Rota:') && story.querySelectorAll('.g-story__questions li').length >= 3 && story.textContent.includes('kişisel'));
const storyBox = $('story-text');
const [saveStory] = story.querySelectorAll('.btn');
storyBox.value = 'Kısa';
saveStory.click();
check('a too short account is not saved', window.localStorage.getItem('dlt:caravanStories') === null);
storyBox.value = 'Kervanımız Kaşgar\'dan çıktı ve önce haritanın merkezindeki şehre gitti; yolda kum fırtınasına yakalandık.';
saveStory.click();
const stories = JSON.parse(window.localStorage.getItem('dlt:caravanStories'));
check('the account is saved on this device with its route', stories.length === 1 && stories[0].route[0] === 'Kaşgar' && stories[0].text.startsWith('Kervanımız'));
G.finish('thirsty');
check('running out of water ends the journey kindly', $('overlay').textContent.includes('Kervan mola verdi'));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll game checks passed');
process.exit(failed ? 1 : 0);
