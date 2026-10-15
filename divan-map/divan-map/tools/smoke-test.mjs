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
const apiCalls = [];
let chatStatus = { available: false, codeRequired: false }; // what GET /api/chat reports
let apiReply = { status: 200, body: { reply: 'Balasagun bölge olarak düşünülmelidir. Dayanak: Balasagun kartı.' } };
window.fetch = async (url, options = {}) => {
  if (String(url) === '/api/chat') {
    if (options.method === 'POST') {
      apiCalls.push({ url, options });
      return { ok: apiReply.status === 200, status: apiReply.status, json: async () => apiReply.body };
    }
    return { ok: true, status: 200, json: async () => chatStatus };
  }
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
check('opening screen shows school, advisor and student', !!$('intro') && ['Maltepe Fen Lisesi', 'Sevil Orhan', 'Yunus Emir OKUMUŞ', 'yeni nesil için'].every((t) => $('intro').textContent.includes(t)));
check('opening screen carries the cover content (title, uncertainty note, legend, map picture)', ['Dîvânu Lugâti\'t-Türk Haritası', 'ölçekli ve koordinatlı değildir', 'örnek içeriktir', 'Tartışmalı'].every((t) => $('intro').textContent.includes(t)) && !!$('intro').querySelector('img[src="assets/original-map.jpg"]'));
check('there is no separate cover dialog any more', $('dlg-welcome') === null);
$('intro-open').click();
await new Promise((r) => setTimeout(r, 900));
check('opening screen removed after "Haritayı aç"', $('intro') === null);
check('the site is directly usable after the opening screen (no dialog open)', !window.document.querySelector('dialog[open]'));
check('page not inert after intro', !window.document.querySelector('[inert]'));
// Turkish-labelled redraw as the default base: record markers are hidden until the original image is shown
check('redraw is the default base of the schematic pane', app.views.schematic.base === 'redraw' && $('base-redraw').getAttribute('aria-pressed') === 'true');
check('pane title names the redraw', $('schematic-title').textContent.includes('Türkçe etiketli'));
check('redraw credit says its source is unverified', $('map-credit').textContent.includes('doğrulanmadı'));
check('record markers are not drawn on the redraw', Object.values(app.views.schematic.groups).every((g) => !app.views.schematic.map.hasLayer(g)));
check('Leaflet attribution control is not added to the schematic map', !window.document.querySelector('#map-schematic .leaflet-control-attribution'));
check('modern map shows the OSM credit without the Leaflet prefix', (() => { const a = window.document.querySelector('#map-modern .leaflet-control-attribution'); return !!a && a.textContent.includes('OpenStreetMap') && !a.textContent.includes('Leaflet'); })());

// explanation cards: hit testing by label, shape, colour class and fallbacks
const ex = app.explainer;
const at = (x, y) => ex.hitTest(x, y, 4);
const K = 1746 / 1100;
check('explainer has annotations and classes', !!ex && ex.annotations.length > 100 && Object.keys(ex.classes).length >= 9);
check('hovering "Balasagun" explains Balasagun with sources', (() => { const r = at(550 * K, 549 * K); return r.title === 'Balasagun' && r.status === 'sourced' && r.sources.length >= 3; })());
check('a label without a source is marked label-only', (() => { const r = at(558 * K, 241 * K); return r.title === 'Canbalık' && r.status === 'label-only' && r.sources.length === 0; })());
check('a polygon area (rotated text) is hit', at(770 * K, 250 * K).title === 'Başaklarla kaplı diyar');
check('a shape beats the colour under it (Işık Göl)', at(600 * K, 512 * K).title.startsWith('Işık Göl'));
check('the outer ring is explained by distance from the centre', at(60, 850).title.includes('Dış halka'));
check('far outside the circle is explained', at(5, 5).title === 'Dairenin dışı');
check('empty ground still gets a card', at(560 * K, 440 * K).title === 'Boş zemin');
check('a modern equivalent is attached where researched', at(560 * K, 100 * K).title === 'Cabarka');
check('every card has text and a status', ex.annotations.every((a) => a.paragraphs.length > 0 || a.status === 'label-only'));

// the card renders without innerHTML, shows the no-source note, and the list dialog reads the same data
ex.focusAnnotation('canbalik');
const xcard = window.document.querySelector('.xcard');
check('pinned card is shown', xcard && !xcard.hidden && xcard.classList.contains('is-pinned'));
check('label-only card says the source search is ongoing', xcard.textContent.includes('kaynak taraması sürüyor'));
check('card has a close button', !!xcard.querySelector('button[aria-label="Açıklama kartını kapat"]'));
ex.focusAnnotation('balasagun');
check('card of a sourced label lists sources as buttons', window.document.querySelectorAll('.xcard .xcard__sources button').length >= 3);
check('card shows the researched modern equivalent', window.document.querySelector('.xcard').textContent.includes('Günümüzdeki karşılığı'));
ex.hide();
check('closing a pinned card hides it', window.document.querySelector('.xcard').hidden === true);
check('labels dialog lists every card', $('labels-body').querySelectorAll('details').length >= 100);
$('labels-search').value = 'hazar';
$('labels-search').dispatchEvent(new window.Event('input'));
check('labels dialog search narrows the list', $('labels-body').querySelectorAll('details').length >= 1 && $('labels-body').querySelectorAll('details').length < 30);
$('labels-search').value = '';
$('labels-search').dispatchEvent(new window.Event('input'));

// top bar menus
const menus = [...window.document.querySelectorAll('[data-menu]')];
check('top bar has four grouped menus', menus.length === 4);
const learn = $('menu-learn-btn');
learn.click();
check('a menu trigger opens its panel', !$('menu-learn').hidden && learn.getAttribute('aria-expanded') === 'true');
$('menu-practice-btn').click();
check('opening another menu closes the first', $('menu-learn').hidden === true && !$('menu-practice').hidden);
$('menu-practice').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Escape closes an open menu', $('menu-practice').hidden === true);
$('menu-learn-btn').click();
$('btn-labels').click();
check('a menu item opens its dialog and closes the menu', $('dlg-labels').hasAttribute('open') && $('menu-learn').hidden === true);
$('dlg-labels').close();
check('menu items have a purpose line', [...window.document.querySelectorAll('.menu__item')].every((b) => b.querySelector('.menu__desc')?.textContent.length > 15));
$('menu-view-btn').click();
$('btn-text-larger').click();
check('settings stay open while adjusting text size', $('menu-view').hidden === false);
$('btn-text-smaller').click();
$('menu-view-btn').click();

// the cover button is gone from the top bar (the cover still opens once per visit)
check('top bar has no "Kapak" button', !window.document.querySelector('.topbar__nav').textContent.includes('Kapak'));

// findings on the modern map
const ml = app.modernLayer;
check('modern layer draws 15 findings (8 water, 7 places)', !!ml && ml.entries.size === 15 && ml.count('water') === 8 && ml.count('place') === 7);
check('unplaceable entries are listed with a reason, not drawn', ml.unplotted.length === 3 && !ml.has('w-ascan') && window.document.querySelector('.geo-legend').textContent.includes('Kaynaklar yeri belirleyemedi'));
check('chips show the counts', $('geo-water-count').textContent === '(8)' && $('geo-place-count').textContent === '(7)');
check('legend says the shapes are not borders', window.document.querySelector('.geo-legend').textContent.includes('Kesin sınır'));
ml.focus('w-balasagun');
const gcard = window.document.querySelector('.xcard--geo');
check('focusing a finding pins its card', !gcard.hidden && gcard.classList.contains('is-pinned') && gcard.textContent.includes('Balasagun') && gcard.textContent.includes('Kırgızistan'));
check('geo card repeats the status in words and says it is no border', gcard.textContent.includes('Kaynaklar aynı karşılığı veriyor') && gcard.textContent.includes('sınır ya da kesin konum değildir'));
check('geo card links to the original map label', gcard.textContent.includes('Özgün haritada göster'));
check('geo card lists sources', gcard.querySelectorAll('.xcard__sources button').length >= 1);
ml.hideCard();
check('closing the geo card hides it', gcard.hidden === true);
$('geo-water').checked = false; $('geo-water').dispatchEvent(new window.Event('change'));
check('the water group can be switched off', ![...ml.entries.values()].some((e) => e.feature.group === 'water' && e.layers.some((l) => app.views.modern.map.hasLayer(l))));
$('geo-water').checked = true; $('geo-water').dispatchEvent(new window.Event('change'));
check('and on again', [...ml.entries.values()].filter((e) => e.feature.group === 'water').every((e) => e.layers.every((l) => app.views.modern.map.hasLayer(l))));
check('the findings table offers "Günümüz haritasında göster" for drawn entries only', $('where-body').querySelectorAll('.equiv-table__show').length === 15);

// hovering a label of the original map outlines nothing on it but marks the linked finding on the modern map
ex.focusAnnotation('balasagun');
check('card of a label with a finding is outlined on the redraw', window.document.querySelectorAll('#map-schematic .xmark__shape').length >= 1);
ex.hide();
check('outline is removed with the card', window.document.querySelectorAll('#map-schematic .xmark__shape').length === 0);
ex.markAnnotations(['balasagun']);
check('linked outline can be drawn from the modern map', window.document.querySelectorAll('#map-schematic .xmark__shape--linked').length >= 1);
ex.markAnnotations([]);

// the AI assistant: opt-in, answered by the site's own /api/chat (no key anywhere in the page)
const assistantModule = await import(path.join(ROOT, 'js/assistant.js'));
const annotationData = JSON.parse(readFileSync(path.join(ROOT, 'data/map-annotations.json'), 'utf8'));
const equivalentData = JSON.parse(readFileSync(path.join(ROOT, 'data/modern-equivalents.json'), 'utf8'));
const sourceData = JSON.parse(readFileSync(path.join(ROOT, 'data/sources.json'), 'utf8'));
const pack = assistantModule.buildContext({
  question: "Balasagun nerede olabilir?",
  annotations: annotationData.annotations,
  classes: annotationData.classes,
  equivalentsById: new Map(equivalentData.records.map((r) => [r.id, r])),
  sourcesById: new Map(sourceData.sources.map((s) => [s.id, s])),
});
check('retrieval finds the Balasagun card and its sources', pack.used[0]?.id === 'balasagun' && pack.text.includes('KART: Balasagun') && pack.text.includes('Kaynaklar:'));
check('retrieval stays small', pack.text.length < 9500);
const emptyPack = assistantModule.buildContext({ question: 'xyzqw', annotations: annotationData.annotations, classes: annotationData.classes, equivalentsById: new Map(), sourcesById: new Map() });
check('no match gives an honest empty pack', emptyPack.text.includes('bulunamadı') && emptyPack.used.length === 0);
check('the page no longer builds the model instructions or handles a provider key', !('buildSystemPrompt' in assistantModule) && !('API_URL' in assistantModule) && !/x-api-key|anthropic/i.test(readFileSync(path.join(ROOT, 'js/assistant.js'), 'utf8').replace(/Anthropic/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
check('request body limits history and question length', (() => {
  const body = assistantModule.buildRequest({ history: Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })), question: 'q'.repeat(900), context: 'c' });
  return body.history.length === 12 && body.question.length === 500 && body.context === 'c' && Object.keys(body).sort().join() === 'context,history,question';
})());
check('error messages are plain Turkish for common results', [[401, 'bad_code'], [429, 'rate'], [403, 'origin'], [503, 'unavailable'], [503, 'busy'], [502], [400], [0]].every(([c, e]) => assistantModule.errorMessage(c, e).length > 15));

check('assistant starts closed', $('assistant').hidden === true);
$('btn-assistant').click();
await new Promise((r) => setTimeout(r, 50));
check('when the server says the assistant is off, the panel says so and offers no form', $('assistant').hidden === false && $('assistant-off').hidden === false && $('assistant-consent-row').hidden === true && $('assistant-save').parentElement.hidden === true && $('assistant-chat').hidden === true);
$('assistant-close').click();

chatStatus = { available: true, codeRequired: true };
$('btn-assistant').click();
await new Promise((r) => setTimeout(r, 50));
check('menu item opens the assistant on the setup page once it is on', $('assistant-setup').hidden === false && $('assistant-consent-row').hidden === false && $('assistant-off').hidden === true && $('assistant-chat').hidden === true);
check('setup page explains privacy and parent consent, and asks for no key', ['kişisel bilgi', 'velinden'].every((t) => $('assistant-setup').textContent.includes(t)) && !window.document.getElementById('assistant-key') && !/API anahtar/i.test($('assistant-setup').textContent));
check('access code field is shown and is a password field', $('assistant-code').hidden === false && $('assistant-code').type === 'password' && $('assistant-code').getAttribute('autocomplete') === 'off');
$('assistant-save').click();
check('the code is required when the site asks for one', $('assistant-setup-msg').textContent.includes('erişim kodunu') && $('assistant-setup').hidden === false);
$('assistant-code').value = 'sinif-kodu';
$('assistant-save').click();
check('consent is required before the first question', $('assistant-setup-msg').textContent.includes('işaretle') && $('assistant-setup').hidden === false);
$('assistant-consent').checked = true;
$('assistant-save').click();
check('saving opens the chat and clears the code field', $('assistant-chat').hidden === false && $('assistant-code').value === '');
check('the code is kept for this tab only', window.sessionStorage.getItem('dlt:assistant-code') === 'sinif-kodu' && window.localStorage.getItem('dlt:assistant-code') === null);
$('assistant-input').value = 'Balasagun nerede olabilir?';
$('assistant-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await new Promise((r) => setTimeout(r, 50));
check('one call was made to the site\'s own endpoint with the access code', apiCalls.length === 1 && apiCalls[0].url === '/api/chat' && apiCalls[0].options.headers['x-access-code'] === 'sinif-kodu');
const sent = JSON.parse(apiCalls[0].options.body);
check('the call carries the question, history and the Balasagun card, and nothing else', sent.question === 'Balasagun nerede olabilir?' && Array.isArray(sent.history) && sent.context.includes('KART: Balasagun') && Object.keys(sent).sort().join() === 'context,history,question');
check('no provider, model name or key is sent from the page', !/api\.anthropic|openai|x-api-key|authorization|sk-/i.test(JSON.stringify(apiCalls[0].options)));
check('the reply is shown as text with related-card buttons', $('assistant-log').textContent.includes('bölge olarak düşünülmelidir') && $('assistant-log').querySelectorAll('.assistant__related button').length >= 1);
$('assistant-log').querySelector('.assistant__related button').click();
check('a related-card button opens that card on the map', window.document.querySelector('.xcard:not(.xcard--geo)').classList.contains('is-pinned'));
ex.hide();
apiReply = { status: 401, body: { error: 'bad_code' } };
$('assistant-input').value = 'Bir soru daha';
$('assistant-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await new Promise((r) => setTimeout(r, 50));
check('a wrong code shows a friendly error, forgets the code and returns to setup', $('assistant-log').textContent.includes('Erişim kodu kabul edilmedi') && $('assistant-setup').hidden === false && window.sessionStorage.getItem('dlt:assistant-code') === null);
apiReply = { status: 429, body: { error: 'rate' } };
chatStatus = { available: true, codeRequired: false };
$('assistant-close').click();
$('btn-assistant').click();
await new Promise((r) => setTimeout(r, 50));
check('without a code requirement the saved consent opens the chat directly', $('assistant-chat').hidden === false && $('assistant-setup').hidden === true);
$('assistant-input').value = 'Hazar nedir?';
$('assistant-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
await new Promise((r) => setTimeout(r, 50));
check('no access-code header is sent when none is required', apiCalls.at(-1).options.headers['x-access-code'] === undefined);
check('a rate limit shows a calm message', $('assistant-log').textContent.includes('Çok fazla soru'));
window.sessionStorage.setItem('dlt:assistant-key', 'old-key');
window.localStorage.setItem('dlt:assistant-key', 'old-key');
$('assistant-forget').click();
check('"delete" also wipes a key left by an earlier version', window.sessionStorage.getItem('dlt:assistant-key') === null && window.localStorage.getItem('dlt:assistant-key') === null);
$('assistant-close').click();
check('the assistant can be closed', $('assistant').hidden === true);
apiReply = { status: 200, body: { reply: 'x' } };

// switching base
$('base-original').click();
check('original base shows record markers again', app.views.schematic.base === 'original' && Object.values(app.views.schematic.groups).every((g) => app.views.schematic.map.hasLayer(g)));
check('the choice is remembered locally', JSON.parse(window.localStorage.getItem('dlt:schematicBase')) === 'original');
$('base-redraw').click();
check('switching back works', app.views.schematic.base === 'redraw');
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

// selection and info card (selecting a record switches the pane to the original image)
$('results').querySelector('button').click();
check('clicking a result opens the info card', $('info-card').hidden === false);
check('selecting a record switches the pane to the original image', app.views.schematic.base === 'original');
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
check('sources dialog lists 10 sources', $('sources-body').querySelectorAll('.source').length === 10);
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
$('dlg-quiz').close();

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

// "Pekiştir" menu and the caravan game (played with the keyboard list here; map clicks are the same rule)
check('the "Pekiştir" menu holds the game, both tests, Sözlüğüm and the find-it activity', $('menu-practice-btn').textContent.includes('Pekiştir') && ['btn-caravan', 'btn-quiz', 'btn-review', 'btn-words', 'btn-activity'].every((id) => $('menu-practice').contains($(id))));
$('btn-activity').click();
$('btn-caravan').click();
const game = window.__dlt.caravan;
check('starting the caravan closes the find-it activity', $('activity-bar').hidden === true);
check('the caravan panel opens with three names', $('caravan').hidden === false && $('caravan-cargo').querySelectorAll('button').length === 3);
check('the game is played on the Turkish-labelled redraw, without hover cards', app.views.schematic.base === 'redraw' && !$('map-schematic').classList.contains('is-explainable'));
check('the caravan and its route are drawn on the map', !!window.document.querySelector('#map-schematic .caravan-marker') && !!window.document.querySelector('#map-schematic .caravan-route'));
const firstTarget = game.state().selectedId;
const wrongPlace = game.stops.find((s) => s.id !== firstTarget && !game.state().cargo.includes(s.id)).id;
const pickBox = $('caravan-pick');
const deliverByList = (id) => { pickBox.value = id; $('caravan-pick-go').click(); };
deliverByList(wrongPlace);
check('a wrong place gives a direction hint in the map\'s own compass', /yönünde/.test($('caravan-feedback').textContent) && game.state().attempts === 1);
deliverByList(wrongPlace);
check('a second wrong try outlines the place and offers its card', !!window.document.querySelector('#map-schematic .caravan-reveal') && $('caravan-card').hidden === false);
check('a place that needed help goes to the review list', JSON.parse(window.localStorage.getItem('dlt:caravanReview')).includes(firstTarget));
deliverByList(firstTarget);
check('the right place is delivered and a new name is loaded', game.state().delivered[0] === firstTarget && game.state().cargo.length === 3 && !game.state().cargo.includes(firstTarget));
check('a delivered name goes to Sözlüğüm', JSON.parse(window.localStorage.getItem('dlt:caravanWords')).includes(firstTarget));
for (let i = 1; i < 8; i += 1) deliverByList(game.state().selectedId);
check('eight deliveries end the journey with a summary', !game.isRunning() && $('caravan').textContent.includes('Yolculuk bitti: 8 teslim, 7 tanesi ilk denemede'));
check('hover cards come back after the journey', $('map-schematic').classList.contains('is-explainable'));
$('btn-words').click();
check('Sözlüğüm lists the eight names', $('words-body').querySelectorAll('.words__item').length === 8);
$('dlg-words').close();
$('btn-review').click();
check('the review quiz starts with the place that needed help', $('review-body').textContent.includes(game.stops.find((s) => s.id === firstTarget).clue));
$('dlg-review').close();
$('caravan-stop').click();
check('closing the panel removes the route from the map', $('caravan').hidden === true && !window.document.querySelector('#map-schematic .caravan-route'));
const quizKept = JSON.parse(window.localStorage.getItem('dlt:quizResult'));
check('the review quiz does not overwrite the mini test result', quizKept && quizKept.quizId === 'map-reading-basics-v0');

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
