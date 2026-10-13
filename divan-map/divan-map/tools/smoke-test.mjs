import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

/**
 * Logic smoke test: bundles the app, runs it in jsdom and exercises boot, filters, search,
 * info card, layers, sources and quiz. It does NOT check visual rendering or real map tiles;
 * test those in a real browser (see README).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = buildSync({ entryPoints: [path.join(ROOT, 'js/main.js')], bundle: true, format: 'iife', write: false, logLevel: 'warning' }).outputFiles[0].text;
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures += 1;
};

// jsdom gaps
window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
window.Element.prototype.scrollIntoView = function () {};
window.fetch = async (url) => {
  const body = readFileSync(path.join(ROOT, url), 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));
window.eval(bundle);
await new Promise((r) => setTimeout(r, 400));

const $ = (id) => window.document.getElementById(id);
const app = window.__dlt;
check('app booted without script errors', !!app && errors.length === 0, errors.join(' | '));
if (!app) process.exit(1);

check('3 demo records loaded', app.state.records.length === 3);
check('demo banner visible', $('demo-banner').hidden === false);
check('cover opened on load', $('dlg-welcome').hasAttribute('open'));
check('default categories listed (3 results)', $('results').children.length === 3);
check('route filter disabled (no route records)', $('cat-route').disabled === true);

// markers per view
check('schematic view has 3 markers', app.views.schematic.entries.size === 3);
check('modern view has 2 markers (demo-001 has no lat/lng)', app.views.modern.entries.size === 2 && !app.views.modern.has('demo-001'));
check('uncertainty areas drawn for approximate + disputed', [...app.views.modern.entries.values()].filter((e) => e.area).length === 2);

// search: diacritics and Turkish letters fold together
const search = (q) => { $('search-input').value = q; $('search-input').dispatchEvent(new window.Event('input')); };
search('ornek dag');
check('search "ornek dag" finds Örnek Dağ C', $('results').children.length === 1 && $('results').textContent.includes('Dağ C'));
search('TOPLULUK B');
check('search is case-insensitive', $('results').children.length === 1);
search('yok boyle bir sey');
check('empty result message shown', $('results-empty').hidden === false && $('search-count').textContent.includes('bulunamadı'));
search('');

// category filter
const geo = $('cat-geography');
geo.checked = false; geo.dispatchEvent(new window.Event('change'));
check('hiding geography leaves 2 results', $('results').children.length === 2);
geo.checked = true; geo.dispatchEvent(new window.Event('change'));
check('showing geography again restores 3', $('results').children.length === 3);

// selection and info card
$('results').querySelector('button').click();
check('clicking a result opens the info card', $('info-card').hidden === false);
check('card shows demo warning', $('info-card').textContent.includes('Örnek içerik'));
check('card says no modern marker for demo-001', $('info-card').textContent.includes('günümüz haritasında işaretlenmemiştir'));
check('progress counts the viewed record', $('progress').textContent.includes('1 / 3'));
app.selectRecord('demo-002');
check('approximate record card explains uncertainty radius', $('info-card').textContent.includes('250 km'));
check('selected marker has highlight class (modern)', !!window.document.querySelector('#map-modern .mk.is-selected'));
app.closeCard();
check('closing card hides it', $('info-card').hidden === true);

// layers
$('layer-modern').checked = false; $('layer-modern').dispatchEvent(new window.Event('change'));
check('unchecking modern hides its pane', $('pane-modern').hidden === true && $('maps').dataset.mode === 'schematic');
$('layer-original').checked = false; $('layer-original').dispatchEvent(new window.Event('change'));
check('last visible map cannot be switched off', $('layer-original').checked === true);

// sources + legend
check('sources dialog lists 7 sources', $('sources-body').querySelectorAll('.source').length === 7);
check('unverified citations are flagged', $('sources-body').textContent.includes('Künye doğrulanacak'));
check('legend lists 4 location types', window.document.querySelector('[data-legend]').querySelectorAll('.legend-list')[0].children.length === 4);

// quiz flow: answer all correctly
$('btn-quiz').click();
const answers = ['b', 'a', 'c', 'a', 'f', 'f', 't'];
for (let i = 0; i < answers.length; i += 1) {
  const q = $('quiz-body');
  q.querySelector(`input[value="${answers[i]}"]`).checked = true;
  q.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  check(`quiz q${i + 1} marks correct`, q.querySelector('.is-correct') !== null && q.textContent.includes('Doğru.'));
  q.querySelector('button.btn--primary:not([hidden])').click();
}
check('quiz summary shows 7 / 7', $('quiz-body').textContent.includes('7 / 7 doğru'));
const stored = JSON.parse(window.localStorage.getItem('dlt:quizResult'));
check('quiz result stored locally without personal fields', stored && Object.keys(stored).sort().join() === 'date,quizId,score,total');

// glossary
check('glossary lists terms', $('glossary-body').querySelectorAll('dt').length >= 10);

// find-it activity: wrong then right answer on the first task
$('btn-activity').click();
check('activity bar visible', $('activity-bar').hidden === false);
const prompt1 = $('activity-bar').querySelector('[data-activity-prompt]').textContent;
check('activity first task is shown', prompt1.startsWith('Görev 1 /'));
const dlt = window.__dlt;
dlt.selectRecord('demo-003'); // disputed record, not a precise one
const fb = $('activity-bar').querySelector('[data-activity-feedback]');
const firstIsPrecise = prompt1.includes('kesin');
check('activity judges a pick', fb.textContent.length > 0);
if (firstIsPrecise) check('wrong pick is not accepted', fb.textContent.includes('Tekrar dene'));
$('activity-bar').querySelector('[data-activity-stop]').click();
check('activity can be closed', $('activity-bar').hidden === true);

// modern equivalents section
check('equivalents table has rows', $('where-body').querySelectorAll('tbody tr').length >= 10);
check('equivalents never claim certainty in the intro', $('where-body').textContent.includes('tek ve kesin bir cevap yoktur'));

// classroom mode
$('btn-present').click();
check('classroom mode toggles body class', window.document.body.classList.contains('presenting'));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
check('classroom mode steps to a record', window.__dlt.state.selectedId !== null);
$('btn-present').click();
check('classroom mode can be turned off', !window.document.body.classList.contains('presenting'));

// research instruments (draft): consent gate, code check, pre-test, CSV
$('btn-research-test').click();
const rb = $('research-body');
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
check('consent is required before the test', rb.textContent.includes('onay kutusunu'));
rb.querySelector('#rs-consent').checked = true;
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
rb.querySelector('#rs-code').value = 'Ali Veli'; // contains a space, looks like a name
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
check('a code that looks like a name is rejected', rb.textContent.includes('yalnızca harf ve rakam'));
rb.querySelector('#rs-code').value = 'K7M2Q';
rb.querySelector('#rs-phase').value = 'pre';
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
check('incomplete pre-test is not saved', rb.textContent.includes('tüm soruları'));
['a1','a2','a3','a4','a5'].forEach((id) => { rb.querySelector(`input[name="${id}"][value="b"]`).checked = true; });
rb.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
const rec = JSON.parse(window.localStorage.getItem('dlt:researchRecords'));
check('pre-test saved locally with code only', rec.length === 1 && rec[0].code === 'K7M2Q' && rec[0].score === 5 && !('name' in rec[0]));
const { recordsToCsv } = await import(path.join(ROOT, 'js/research.js'));
const csv = recordsToCsv(rec, JSON.parse(readFileSync(path.join(ROOT, 'data/research-instruments.json'), 'utf8')));
check('csv has header and one row', csv.split('\n').length === 2 && csv.startsWith('code,phase,date,score'));

// clear local data
$('btn-clear-local').click();
check('clear button removes all dlt: keys', Object.keys(window.localStorage).filter((k) => k.startsWith('dlt:')).length === 0);

// no innerHTML of record text: a hostile name must stay text
app.state.records[0].historical_name = '<img src=x onerror=alert(1)>';
app.selectRecord('demo-001');
check('record text is not parsed as HTML', $('info-card').querySelector('img') === null);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
