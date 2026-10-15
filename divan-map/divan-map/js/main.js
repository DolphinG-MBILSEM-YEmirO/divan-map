/**
 * Application entry point: loads data, creates the map views and wires the interface.
 *
 * State lives in one plain object. Every change goes through a small set of
 * functions (refresh, selectRecord, closeCard, applyLayout) so features stay independent.
 */
import { MapView } from './maps.js';
import { createActivity } from './activity.js';
import { createQuiz } from './quiz.js';
import { createResearch } from './research.js';
import { clearAllLocal, readLocal, writeLocal } from './storage.js';
import { normalizeText, el } from './text.js';
import { renderCategoryFilters, renderInfoCard, renderEquivalents, renderGlossary, renderLegend, renderResults, renderSources } from './ui.js';
import { playIntro } from './intro.js';
import { createExplainer } from './explain.js';
import { renderLabelsList } from './labels-list.js';
import { createModernLayer } from './modern-layer.js';
import { createAssistant, forgetStoredKey } from './assistant.js';

const TEXT_SCALES = [100, 115, 130, 150];
const NARROW_QUERY = window.matchMedia('(max-width: 860px)');

const $ = (id) => document.getElementById(id);

const dom = {
  layout: $('layout'),
  sidebar: $('sidebar'),
  maps: $('maps'),
  paneSchematic: $('pane-schematic'),
  paneModern: $('pane-modern'),
  card: $('info-card'),
  results: $('results'),
  resultsEmpty: $('results-empty'),
  searchForm: $('search-form'),
  searchInput: $('search-input'),
  searchCount: $('search-count'),
  filters: $('category-filters'),
  layerOriginal: $('layer-original'),
  layerModern: $('layer-modern'),
  progress: $('progress'),
  statusBanner: $('status-banner'),
  demoBanner: $('demo-banner'),
  sidebarToggle: $('btn-sidebar'),
  presentButton: $('btn-present'),
};

const state = {
  config: null,
  records: [],
  sourcesById: new Map(),
  enabledCategories: new Set(['place', 'group', 'geography']),
  showOriginal: true,
  showModern: !NARROW_QUERY.matches, // a phone shows one map at a time
  query: '',
  selectedId: null,
  viewed: new Set(readLocal('viewed', [])),
  lastTrigger: null,
};

const views = {};
let activity = null;
let explainer = null;
let modernLayer = null;
let assistant = null;
let lastAnnotationId = null; // the card the visitor looked at last (context for the assistant)
const shownOnce = new Set();

// ------------------------------------------------------------------ messages

function showStatus(message) {
  dom.statusBanner.textContent = message ?? '';
  dom.statusBanner.hidden = !message;
}

function showFatal(message) {
  document.getElementById('intro')?.remove(); // never let the intro cover an error
  dom.layout.replaceChildren(el('p', { class: 'banner banner--status' }, message));
}

// ------------------------------------------------------------------ filtering

function matchesQuery(record, normalizedQuery) {
  if (!normalizedQuery) return true;
  return record._search.includes(normalizedQuery);
}

function visibleRecords() {
  const query = normalizeText(state.query);
  return state.records.filter((r) => state.enabledCategories.has(r.category) && matchesQuery(r, query));
}

function refresh() {
  const visible = visibleRecords();
  const ids = new Set(visible.map((r) => r.id));
  Object.values(views).forEach((view) => view.showOnly(ids));

  renderResults(dom.results, visible, { selectedId: state.selectedId, onPick: (id, trigger) => selectRecord(id, { focus: true, trigger }) });
  dom.resultsEmpty.hidden = visible.length > 0;
  $('results-count').textContent = `(${visible.length})`;
  dom.searchCount.textContent = state.query
    ? visible.length
      ? `${visible.length} kayıt bulundu.`
      : 'Kayıt bulunamadı.'
    : '';
}

function updateProgress() {
  const total = state.records.length;
  dom.progress.textContent = `Keşfedilen kayıt: ${state.viewed.size} / ${total}`;
  const fill = $('progress-fill');
  if (fill) fill.style.width = total ? `${Math.round((state.viewed.size / total) * 100)}%` : '0%';
}

// ------------------------------------------------------------------ selection

function positionNotes(id) {
  const notes = [];
  if (state.showOriginal && !views.schematic.has(id)) {
    notes.push('Bu kaydın özgün haritada işaretli bir konumu yok.');
  }
  if (state.showModern && !views.modern.has(id)) {
    notes.push('Bu kayıt günümüz haritasında işaretlenmemiştir; kaynaklar yeterli bir karşılık sunmuyor.');
  }
  return notes;
}

function renderCard(record) {
  const title = renderInfoCard(dom.card, record, {
    sourcesById: state.sourcesById,
    notes: positionNotes(record.id),
    onClose: closeCard,
    onOpenSource: openSource,
  });
  dom.card.hidden = false;
  dom.layout.classList.add('has-card');
  return title;
}

function selectRecord(id, { focus = false, trigger = null } = {}) {
  const record = state.records.find((r) => r.id === id);
  if (!record) return;
  showOriginalBase(); // record markers are placed on the original image only
  state.selectedId = id;
  state.lastTrigger = trigger ?? document.activeElement;
  if (activity?.isActive()) activity.answer(record);

  Object.values(views).forEach((view) => view.select(id, { focus }));

  const title = renderCard(record);
  closeSidebarOnNarrow();
  // The card changes the map size on wide screens.
  requestAnimationFrame(() => Object.values(views).forEach((view) => view.refreshSize()));
  title.focus();

  if (!state.viewed.has(id)) {
    state.viewed.add(id);
    writeLocal('viewed', [...state.viewed]);
    updateProgress();
  }
  refresh();
}

function closeCard() {
  state.selectedId = null;
  Object.values(views).forEach((view) => view.clearSelection());
  dom.card.hidden = true;
  dom.layout.classList.remove('has-card');
  requestAnimationFrame(() => Object.values(views).forEach((view) => view.refreshSize()));
  refresh();
  // Markers and list items are re-created on refresh, so fall back to a stable element.
  const trigger = state.lastTrigger;
  const target = trigger && document.body.contains(trigger) ? trigger : dom.results.querySelector('button') ?? dom.searchInput;
  target.focus();
}

// ------------------------------------------------------------ schematic base

const BASE_TITLES = { redraw: 'Özgün haritanın Türkçe etiketli çizimi', original: 'Özgün harita' };
const TOUCH_ONLY = window.matchMedia('(hover: none)').matches;
const BASE_NOTES = {
  redraw: TOUCH_ONLY
    ? 'Haritaya dokun: dokunduğun yazı, çizgi ve renk açıklanır.'
    : 'Fareni haritada gezdir: her yazı, çizgi ve renk açıklanır. Kartı sabitlemek için tıkla.',
  original: 'Bu görselde kayıt işaretleri görünür. Yazı ve çizgi açıklamaları Türkçe etiketli çizimde bulunur.',
};

/** Updates the pane title, the switch buttons, the credit line and the explanation cards after a base change. */
function syncBaseUi() {
  const view = views.schematic;
  const base = view.base;
  $('schematic-title').textContent = BASE_TITLES[base];
  $('base-redraw').setAttribute('aria-pressed', String(base === 'redraw'));
  $('base-original').setAttribute('aria-pressed', String(base === 'original'));
  $('base-note').textContent = view.hasRedraw() ? BASE_NOTES[base] : '';
  explainer?.setActive(base === 'redraw');

  const { originalMap, redrawMap } = state.config;
  const credit = $('map-credit');
  const text = base === 'redraw' ? redrawMap?.credit : originalMap.imagePath && originalMap.license ? `Görsel: ${originalMap.license}` : '';
  credit.textContent = text ?? '';
  credit.hidden = !credit.textContent;
}

function chooseBase(name, { remember = true } = {}) {
  views.schematic.setBase(name);
  if (remember) writeLocal('schematicBase', views.schematic.base);
}

/** Markers and the find-it activity need the original image; switch to it when they are used. */
function showOriginalBase() {
  if (views.schematic?.base === 'redraw') chooseBase('original', { remember: false });
}

/** Opens the explanation card of one label on the redraw (used by the list of labels). */
function showAnnotation(id) {
  if (!state.showOriginal) {
    state.showOriginal = true;
    dom.layerOriginal.checked = true;
    applyLayout();
  }
  chooseBase('redraw', { remember: false });
  $('labels-title').closest('dialog').close();
  requestAnimationFrame(() => {
    views.schematic.refreshSize();
    explainer?.focusAnnotation(id);
    closeSidebarOnNarrow();
  });
}

/** The toggles of the modern pane: which groups of findings are drawn on the present-day map. */
function wireGeoChips() {
  for (const group of ['water', 'place']) {
    const input = $(`geo-${group}`);
    $(`geo-${group}-count`).textContent = `(${modernLayer.count(group)})`;
    input.addEventListener('change', () => modernLayer.setGroupVisible(group, input.checked));
  }
}

/** Shows one finding on the present-day map (used by the list of findings). */
function showOnModernMap(id) {
  if (!state.showModern) {
    state.showModern = true;
    dom.layerModern.checked = true;
    applyLayout();
  }
  $('where-title').closest('dialog').close();
  const group = modernLayer.entries.get(id)?.feature.group;
  if (group && !$(`geo-${group}`).checked) {
    $(`geo-${group}`).checked = true;
    modernLayer.setGroupVisible(group, true);
  }
  requestAnimationFrame(() => {
    views.modern.refreshSize();
    modernLayer.focus(id);
    closeSidebarOnNarrow();
  });
}

function wireBaseSwitch() {
  const redrawAvailable = views.schematic.hasRedraw();
  for (const id of ['base-redraw', 'base-original', 'btn-labels-pane']) $(id).hidden = !redrawAvailable;
  $('base-redraw').addEventListener('click', () => chooseBase('redraw'));
  $('base-original').addEventListener('click', () => chooseBase('original'));
}

// --------------------------------------------------------------------- layout

function applyLayout() {
  const both = state.showOriginal && state.showModern;
  dom.maps.dataset.mode = both ? 'both' : state.showOriginal ? 'schematic' : 'modern';
  dom.paneSchematic.hidden = !state.showOriginal;
  dom.paneModern.hidden = !state.showModern;
  requestAnimationFrame(() => {
    for (const [kind, view] of Object.entries(views)) {
      const shown = kind === 'schematic' ? state.showOriginal : state.showModern;
      if (!shown) continue;
      view.refreshSize();
      if (!shownOnce.has(kind)) {
        view.resetView(); // a pane hidden at start has no size yet, so fit it when first shown
        shownOnce.add(kind);
      }
    }
  });
}

function onLayerToggle(changedInput, key) {
  state[key] = changedInput.checked;
  if (!state.showOriginal && !state.showModern) {
    // At least one map must stay visible.
    state[key] = true;
    changedInput.checked = true;
    dom.searchCount.textContent = 'En az bir harita katmanı açık kalmalıdır.';
  }
  applyLayout();
  const selected = state.records.find((r) => r.id === state.selectedId);
  if (selected) renderCard(selected); // notes depend on which maps are visible; keep focus where it is
}

function setSidebarOpen(open) {
  dom.sidebar.classList.toggle('is-open', open);
  dom.sidebarToggle.setAttribute('aria-expanded', String(open));
}

function closeSidebarOnNarrow() {
  if (NARROW_QUERY.matches) setSidebarOpen(false);
}

// ---------------------------------------------------------------------- menus

/**
 * Disclosure menus of the top bar. A trigger button opens a panel of ordinary buttons;
 * Esc or a click outside closes it, and Esc returns focus to the trigger.
 */
function wireMenus() {
  const menus = [...document.querySelectorAll('[data-menu]')];
  const close = (menu, { restoreFocus = false } = {}) => {
    const trigger = menu.querySelector('.menu__trigger');
    const panel = menu.querySelector('.menu__panel');
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  const closeAll = (except = null) => menus.forEach((m) => { if (m !== except) close(m); });

  for (const menu of menus) {
    const trigger = menu.querySelector('.menu__trigger');
    const panel = menu.querySelector('.menu__panel');
    trigger.addEventListener('click', () => {
      const willOpen = panel.hidden;
      closeAll();
      panel.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
    });
    panel.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button && !button.hasAttribute('data-keep-open') && !button.closest('.menu__row')) close(menu);
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        event.stopPropagation();
        close(menu, { restoreFocus: true });
      }
    });
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-menu]')) closeAll();
  });
}

// -------------------------------------------------------------------- dialogs

function openDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}

function wireDialogs() {
  document.querySelectorAll('[data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const current = button.closest('dialog');
      if (current) current.close();
      openDialog(button.dataset.openDialog);
    });
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close(); // click on the backdrop
    });
    dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
  });
}

function openSource(sourceId) {
  $('dlg-sources').showModal();
  const target = document.getElementById(`source-${sourceId}`);
  if (target) {
    target.classList.add('is-flash');
    target.scrollIntoView({ block: 'center' });
  }
}

// ------------------------------------------------------------------- settings

function applyTextScale(index) {
  const safe = Math.min(Math.max(index, 0), TEXT_SCALES.length - 1);
  document.documentElement.style.fontSize = `${TEXT_SCALES[safe]}%`;
  writeLocal('textScale', safe);
  Object.values(views).forEach((view) => view.refreshSize());
  return safe;
}

function stepRecord(direction) {
  const visible = visibleRecords();
  if (!visible.length) return;
  const current = visible.findIndex((r) => r.id === state.selectedId);
  const next = current === -1 ? (direction > 0 ? 0 : visible.length - 1) : (current + direction + visible.length) % visible.length;
  selectRecord(visible[next].id, { focus: false, trigger: dom.presentButton });
}

function wirePresentationMode() {
  const button = dom.presentButton;
  const set = (on) => {
    document.body.classList.toggle('presenting', on);
    button.setAttribute('aria-pressed', String(on));
    requestAnimationFrame(() => Object.values(views).forEach((view) => view.refreshSize()));
  };
  button.addEventListener('click', () => set(!document.body.classList.contains('presenting')));
  document.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('presenting')) return;
    if (document.querySelector('dialog[open]')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'PageDown' || event.key === 'n') { event.preventDefault(); stepRecord(1); }
    if (event.key === 'PageUp' || event.key === 'p') { event.preventDefault(); stepRecord(-1); }
  });
}

function wireSettings() {
  let scale = readLocal('textScale', 0);
  scale = applyTextScale(Number.isInteger(scale) ? scale : 0);
  $('btn-text-smaller').addEventListener('click', () => { scale = applyTextScale(scale - 1); });
  $('btn-text-larger').addEventListener('click', () => { scale = applyTextScale(scale + 1); });

  const contrastButton = $('btn-contrast');
  const setContrast = (on) => {
    document.body.classList.toggle('hc', on);
    contrastButton.setAttribute('aria-pressed', String(on));
    writeLocal('highContrast', on);
  };
  setContrast(readLocal('highContrast', false) === true);
  contrastButton.addEventListener('click', () => setContrast(!document.body.classList.contains('hc')));

  $('btn-clear-local').addEventListener('click', () => {
    forgetStoredKey();
    const removed = clearAllLocal();
    state.viewed.clear();
    updateProgress();
    scale = applyTextScale(0);
    setContrast(false);
    clearAllLocal(); // applying defaults wrote keys again, so remove them too
    $('clear-feedback').textContent = removed ? 'Bu cihazdaki kayıtlı veriler silindi.' : 'Silinecek kayıtlı veri yoktu.';
  });
}

// ----------------------------------------------------------------------- boot

async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function prepareRecords(records) {
  return records.map((r) => ({
    ...r,
    _search: normalizeText(
      [r.historical_name, ...(r.alt_spellings ?? []), r.modern_name, r.related_group].filter(Boolean).join(' | '),
    ),
  }));
}

function wireControls() {
  dom.layerOriginal.checked = state.showOriginal;
  dom.layerModern.checked = state.showModern;
  dom.layerOriginal.addEventListener('change', () => onLayerToggle(dom.layerOriginal, 'showOriginal'));
  dom.layerModern.addEventListener('change', () => onLayerToggle(dom.layerModern, 'showModern'));

  dom.searchInput.addEventListener('input', () => {
    state.query = dom.searchInput.value;
    refresh();
  });
  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom.searchInput.value) {
      dom.searchInput.value = '';
      state.query = '';
      refresh();
    }
  });
  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const [first] = visibleRecords();
    if (first) selectRecord(first.id, { focus: true, trigger: dom.searchInput });
  });

  $('btn-reset-view').addEventListener('click', () => {
    Object.entries(views).forEach(([kind, view]) => {
      const shown = kind === 'schematic' ? state.showOriginal : state.showModern;
      if (shown) view.resetView();
    });
  });
  dom.sidebarToggle.addEventListener('click', () => setSidebarOpen(!dom.sidebar.classList.contains('is-open')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
      if (dom.sidebar.classList.contains('is-open')) setSidebarOpen(false);
      else if (state.selectedId) closeCard();
    }
  });

  window.addEventListener('offline', () => showStatus('Çevrimdışısın. Günümüz altlığının harita parçaları yüklenmeyebilir; özgün harita ve kayıtlar kullanılabilir.'));
  window.addEventListener('online', () => showStatus(null));
}

function renderFilters() {
  const counts = {};
  state.records.forEach((r) => { counts[r.category] = (counts[r.category] ?? 0) + 1; });
  renderCategoryFilters(dom.filters, {
    counts,
    enabled: state.enabledCategories,
    onChange: (category, checked) => {
      if (checked) state.enabledCategories.add(category);
      else state.enabledCategories.delete(category);
      refresh();
    },
  });
}

async function boot() {
  if (!window.L) {
    showFatal('Harita kütüphanesi yüklenemedi. vendor/leaflet klasörünün yerinde olduğunu kontrol et.');
    return;
  }

  let data;
  try {
    const [config, places, sources, quiz, glossary, instruments, equivalents, annotations, geo] = await Promise.all([
      loadJson('data/config.json'),
      loadJson('data/places.json'),
      loadJson('data/sources.json'),
      loadJson('data/quiz.json'),
      loadJson('data/glossary.json'),
      loadJson('data/research-instruments.json'),
      loadJson('data/modern-equivalents.json'),
      loadJson('data/map-annotations.json'),
      loadJson('data/modern-geo.json'),
    ]);
    data = { config, places, sources, quiz, glossary, instruments, equivalents, annotations, geo };
  } catch (error) {
    console.error(error);
    showFatal(
      location.protocol === 'file:'
        ? 'Veriler dosyadan açıldığında okunamaz. Proje klasöründe "python3 -m http.server" komutunu çalıştırıp tarayıcıda http://localhost:8000 adresini aç.'
        : 'Veri dosyaları yüklenemedi. Sayfayı yenile; sorun sürerse veri dosyalarının yerinde olduğunu kontrol et.',
    );
    return;
  }

  state.config = data.config;
  state.records = prepareRecords(data.places.records);
  data.sources.sources.forEach((s) => state.sourcesById.set(s.id, s));
  dom.demoBanner.hidden = !state.records.some((r) => r.is_demo);

  // Layout first, so each map is created inside a visible, sized container.
  applyLayout();

  const onStatus = ({ type }) => {
    if (type === 'tiles-failed') showStatus('Günümüz altlık haritası yüklenemedi. İnternet bağlantını kontrol et. Özgün harita ve kayıtlar kullanılabilir.');
    if (type === 'tiles-ok') showStatus(null);
  };
  views.schematic = new MapView({ container: $('map-schematic'), kind: 'schematic', config: state.config, onSelect: (id) => selectRecord(id, { trigger: document.activeElement }), onStatus });
  views.modern = new MapView({ container: $('map-modern'), kind: 'modern', config: state.config, onSelect: (id) => selectRecord(id, { trigger: document.activeElement }), onStatus });
  Object.values(views).forEach((view) => view.setRecords(state.records));

  // Explanation cards belong to the Turkish-labelled redraw; without that image the map works as before.
  views.schematic.onBaseChange = syncBaseUi;
  const equivalentsById = new Map(data.equivalents.records.map((r) => [r.id, r]));
  const equivalentIdOf = (target) => target?.annotation?.equivalentId ?? target?.near?.equivalentId ?? null;
  if (views.schematic.hasRedraw()) {
    explainer = createExplainer({
      view: views.schematic,
      pane: dom.paneSchematic,
      config: state.config,
      data: data.annotations,
      sourcesById: state.sourcesById,
      equivalentsById,
      onOpenSource: openSource,
      onTarget: (target) => {
        if (target?.annotation) lastAnnotationId = target.annotation.id;
        modernLayer?.highlight(equivalentIdOf(target));
      },
    });
    renderLabelsList({
      body: $('labels-body'),
      search: $('labels-search'),
      count: $('labels-count'),
      annotations: explainer.annotations,
      sourcesById: state.sourcesById,
      equivalentsById,
      onShow: showAnnotation,
      onOpenSource: openSource,
    });
    $('labels-notice').textContent = data.annotations.notice;
  }
  const storedBase = readLocal('schematicBase', null);
  chooseBase(views.schematic.hasRedraw() && storedBase !== 'original' ? 'redraw' : 'original', { remember: false });
  wireBaseSwitch();

  document.querySelectorAll('[data-legend]').forEach(renderLegend);
  renderSources($('sources-body'), data.sources.sources);
  $('sources-notice').textContent = data.sources.notice;
  renderGlossary($('glossary-body'), data.glossary.terms);
  modernLayer = createModernLayer({
    view: views.modern,
    pane: dom.paneModern,
    geo: data.geo,
    equivalents: data.equivalents.records,
    annotations: data.annotations.annotations,
    sourcesById: state.sourcesById,
    onOpenSource: openSource,
    onHover: (id) => {
      if (!explainer || views.schematic.base !== 'redraw' || !state.showOriginal) return;
      explainer.markAnnotations(id ? data.annotations.annotations.filter((a) => a.equivalentId === id).map((a) => a.id) : []);
    },
    onShowOnOriginal: (id) => {
      const first = data.annotations.annotations.find((a) => a.equivalentId === id);
      if (first) showAnnotation(first.id);
    },
  });
  wireGeoChips();
  renderEquivalents($('where-body'), data.equivalents, state.sourcesById, openSource, { plottedIds: new Set(modernLayer.entries.keys()), onShowOnMap: showOnModernMap });
  assistant = createAssistant({
    annotations: data.annotations.annotations,
    classes: data.annotations.classes,
    equivalentsById,
    sourcesById: state.sourcesById,
    getCurrentId: () => lastAnnotationId,
    onShowCard: (id) => { if (explainer) showAnnotation(id); },
  });
  $('btn-assistant').addEventListener('click', () => assistant.open());
  $('glossary-notice').textContent = data.glossary.notice;
  $('quiz-notice').textContent = data.quiz.notice;
  const quiz = createQuiz({ container: $('quiz-body'), quiz: data.quiz });
  $('btn-quiz').addEventListener('click', quiz.start);
  const research = createResearch({ container: $('research-body'), instruments: data.instruments });
  $('btn-research-test').addEventListener('click', research.start);
  activity = createActivity({ bar: $('activity-bar'), records: state.records });
  $('btn-activity').addEventListener('click', () => { closeCard(); showOriginalBase(); activity.start(); });

  renderFilters();
  wireControls();
  wireDialogs();
  wireMenus();
  wireSettings();
  wirePresentationMode();
  updateProgress();
  applyLayout(); // fit the freshly created maps
  refresh();

  await playIntro(); // opening screen (animation and cover in one view); the site appears directly after it
}

boot();

// Exposed for tests and debugging only; not part of the interface.
window.__dlt = { state, views, selectRecord, closeCard, get explainer() { return explainer; }, get modernLayer() { return modernLayer; }, get assistant() { return assistant; } };
