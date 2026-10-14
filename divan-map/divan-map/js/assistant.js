/**
 * Harita asistanı: an opt-in AI helper that answers questions from the cards and sources of this site.
 *
 * How it works, and what it does NOT do:
 *  - The page never holds or asks for an API key. It sends {question, history, context} to this site's own
 *    endpoint (`/api/chat`, see api/_proxy.js). The provider key lives only in the server's environment variables,
 *    so nobody who inspects the page can read it. The fixed instructions for the model are also set on the server.
 *  - Before every question the most relevant cards of the site (annotations, modern equivalents, sources) are
 *    collected locally and sent with it as the only material the model may use (a small "retrieval" step).
 *  - The model is told to say so when the pack does not contain an answer, never to present a place or border as
 *    certain, and to name the cards and sources it relied on. It can still be wrong; the panel says so.
 *  - Answers are shown as plain text (textContent), never as HTML.
 *  - Stored on the visitor's device: the consent tick (localStorage, removed by "delete my data") and, only if the
 *    site asks for an access code, that code for this tab (sessionStorage).
 *
 * The pure helpers (buildContext, buildRequest, errorMessage) are exported for tests.
 */
import { ANNOTATION_KIND, ANNOTATION_STATUS, EQUIVALENT_STATUS } from './labels.js';
import { readLocal, writeLocal } from './storage.js';
import { el, normalizeText } from './text.js';

export const CHAT_URL = '/api/chat';
const CODE_STORAGE = 'dlt:assistant-code'; // same prefix as storage.js
const LEGACY_KEY_STORAGE = 'dlt:assistant-key'; // earlier versions kept a personal key here; it is wiped on sight
const MAX_CONTEXT_CHARS = 9000; // the server accepts up to 9500
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;
const STOP_WORDS = new Set(['nedir', 'nerede', 'nasil', 'neden', 'hangi', 'icin', 'ile', 'bir', 'bu', 'su', 've', 'mi', 'mu', 'ne', 'var', 'gibi', 'olan', 'ama', 'veya', 'daha', 'cok', 'haritada', 'harita', 'anlama', 'gelir', 'soyler', 'anlat', 'hakkinda']);

export const SUGGESTIONS = [
  'Balasagun nerede olabilir?',
  'Kırmızı çizgiler ne anlama geliyor?',
  'Bu harita neden dairesel?',
  'Hangi yerlerin günümüzde karşılığı tartışmalı?',
];

// ------------------------------------------------------------------ pure helpers

function keywords(text) {
  return [...new Set(normalizeText(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOP_WORDS.has(word)))];
}

function stem(word) {
  // Turkish is agglutinative ("Balasagun'un", "Hazar'ın"): matching on a short prefix keeps suffixed forms.
  return word.length > 5 ? word.slice(0, word.length - 2) : word;
}

function score(haystack, label, words) {
  let total = 0;
  for (const word of words) {
    const root = stem(word);
    if (label.includes(root)) total += 5;
    else if (haystack.includes(root)) total += 1;
  }
  return total;
}

function sourceLine(refs, sourcesById) {
  if (!refs?.length) return '';
  const parts = refs.map((ref) => {
    const source = sourcesById.get(ref.source_id);
    return `${source?.short ?? source?.title ?? ref.source_id}${ref.locator ? ` (${ref.locator})` : ''}`;
  });
  return `Kaynaklar: ${parts.join('; ')}`;
}

/**
 * Collects the cards that best match a question.
 * @returns {{text: string, used: {id: string, label: string}[]}} `text` is the pack sent to the model; `used` lists annotation cards (for "related cards" buttons).
 */
export function buildContext({ question, annotations, classes, equivalentsById, sourcesById, currentId = null, limit = 7 }) {
  const words = keywords(question);
  const picked = [];
  const taken = new Set();
  const take = (annotation) => {
    if (!annotation || taken.has(annotation.id)) return;
    taken.add(annotation.id);
    picked.push(annotation);
  };

  if (currentId) take(annotations.find((a) => a.id === currentId));
  const ranked = annotations
    .filter((a) => a.layer !== 'area' || a.paragraphs.length)
    .map((a) => ({ annotation: a, value: score(normalizeText([a.label, ...a.paragraphs].join(' ')), normalizeText(a.label), words) }))
    .filter((item) => item.value > 0)
    .sort((x, y) => y.value - x.value);
  for (const item of ranked) {
    if (picked.length >= limit) break;
    take(item.annotation);
  }

  const blocks = [];
  let size = 0;
  const add = (block) => {
    if (size + block.length > MAX_CONTEXT_CHARS) return;
    blocks.push(block);
    size += block.length;
  };

  for (const annotation of picked) {
    const status = ANNOTATION_STATUS[annotation.status];
    const equivalent = annotation.equivalentId ? equivalentsById.get(annotation.equivalentId) : null;
    const lines = [
      `KART: ${annotation.label} (${ANNOTATION_KIND[annotation.kind] ?? annotation.kind}; durum: ${status?.label ?? annotation.status})`,
      ...annotation.paragraphs,
    ];
    if (annotation.status === 'label-only') lines.push('Bu yazı için kaynaklarda ayrıntılı açıklama bulunamadı.');
    if (equivalent) {
      const eqStatus = EQUIVALENT_STATUS[equivalent.status];
      lines.push(`Günümüz karşılığı (araştırmacılara göre): ${equivalent.modern_equivalent} [${eqStatus?.label ?? equivalent.status}]${equivalent.note ? ` ${equivalent.note}` : ''}`);
    }
    const sources = sourceLine(annotation.sources, sourcesById);
    if (sources) lines.push(sources);
    add(lines.join('\n'));
  }

  // Colour and symbol explanations ("what is a red line?").
  for (const info of Object.values(classes ?? {})) {
    const value = score(normalizeText([info.title, ...info.paragraphs].join(' ')), normalizeText(info.title), words);
    if (value < 5) continue;
    const lines = [`SİMGE/RENK: ${info.title}`, ...info.paragraphs];
    const sources = sourceLine(info.sources, sourcesById);
    if (sources) lines.push(sources);
    add(lines.join('\n'));
  }

  // Modern equivalents that the question names, even when no card links to them.
  for (const record of equivalentsById.values()) {
    const value = score(normalizeText(`${record.historical_name} ${record.modern_equivalent}`), normalizeText(record.historical_name), words);
    if (value < 5) continue;
    const eqStatus = EQUIVALENT_STATUS[record.status];
    add(`KARŞILIK: ${record.historical_name} → ${record.modern_equivalent} [${eqStatus?.label ?? record.status}]${record.note ? ` ${record.note}` : ''}\n${sourceLine(record.sources, sourcesById)}`);
  }

  return {
    text: blocks.length ? blocks.join('\n\n') : 'Bu soruyla eşleşen kart bulunamadı.',
    used: picked.map((a) => ({ id: a.id, label: a.label })),
  };
}

/** The body sent to /api/chat. */
export function buildRequest({ question, history, context }) {
  return {
    question: question.slice(0, MAX_QUESTION_CHARS),
    history: history.slice(-MAX_HISTORY_TURNS * 2),
    context,
  };
}

/** Turkish message for a failed call. `code` is the `error` field the server sends back, if any. */
export function errorMessage(status, code) {
  if (code === 'bad_code' || status === 401) return 'Erişim kodu kabul edilmedi. Kodu kontrol edip yeniden gir.';
  if (code === 'rate' || status === 429) return 'Çok fazla soru soruldu. Biraz bekleyip yeniden dene.';
  if (code === 'origin' || status === 403) return 'Asistan bu adresten kullanılamıyor.';
  if (code === 'unavailable') return 'Asistan şu an kapalı.';
  if (code === 'busy') return 'Yapay zekâ hizmeti şu an yoğun. Biraz sonra yeniden dene.';
  if (status === 400) return 'Soru gönderilemedi. Daha kısa bir soru yazmayı dene.';
  if (status >= 500) return 'Yapay zekâ hizmeti şu an yanıt vermiyor. Biraz sonra yeniden dene.';
  if (status === 0) return 'Hizmete bağlanılamadı. İnternet bağlantını kontrol et.';
  return 'Yanıt alınamadı. Biraz sonra yeniden dene.';
}

// ------------------------------------------------------------------ small storage helpers

function readSession(key) {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key, value) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* storage blocked: the code then lives only in memory */ }
}
function removeDevice(key) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Removes what the assistant keeps on this tab and device: the access code and any key left by an earlier version (used by "delete my data"). */
export function forgetStoredKey() {
  writeSession(CODE_STORAGE, null);
  writeSession(LEGACY_KEY_STORAGE, null);
  removeDevice(LEGACY_KEY_STORAGE);
}

// ------------------------------------------------------------------ the panel

/**
 * @param {object} options
 * @param {object[]} options.annotations Prepared annotations of the original map.
 * @param {object} options.classes Colour/symbol explanations of data/map-annotations.json.
 * @param {Map<string, object>} options.equivalentsById
 * @param {Map<string, object>} options.sourcesById
 * @param {() => string|null} options.getCurrentId Id of the annotation the visitor is looking at, if any.
 * @param {(annotationId: string) => void} options.onShowCard Opens an annotation on the map.
 * @param {typeof fetch} [options.fetchImpl] Replaceable for tests.
 */
export function createAssistant({ annotations, classes, equivalentsById, sourcesById, getCurrentId = () => null, onShowCard = () => {}, fetchImpl = (...args) => window.fetch(...args) }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('assistant');
  const fab = $('btn-assistant-fab');
  const setup = $('assistant-setup');
  const chat = $('assistant-chat');
  const log = $('assistant-log');
  const input = $('assistant-input');
  const send = $('assistant-send');
  const settingsButton = $('assistant-settings');
  const fields = ['assistant-rules', 'assistant-consent-row', 'assistant-actions'].map($); // shown whenever the assistant is on
  const codeParts = ['assistant-code-label', 'assistant-code', 'assistant-code-help'].map($); // shown only when a code is required
  const offNote = $('assistant-off');
  const feedback = $('assistant-setup-msg');

  const history = [];
  let busy = false;
  let controller = null;
  let status = null; // {available, codeRequired} once the server answered
  let code = readSession(CODE_STORAGE) ?? '';
  removeDevice(LEGACY_KEY_STORAGE); // a key typed into an earlier version must not stay on the device
  writeSession(LEGACY_KEY_STORAGE, null);

  $('assistant-consent').checked = readLocal('assistantConsent', false) === true;

  const consented = () => readLocal('assistantConsent', false) === true;
  const hasAccess = () => Boolean(status?.available) && consented() && (!status.codeRequired || Boolean(code));

  /** Asks the server whether the assistant is switched on (and whether it wants a code). Never throws. */
  async function loadStatus() {
    try {
      const response = await fetchImpl(CHAT_URL, { method: 'GET', headers: { accept: 'application/json' } });
      const json = response.ok ? await response.json() : null;
      status = json && typeof json.available === 'boolean' ? { available: json.available, codeRequired: Boolean(json.codeRequired) } : { available: false, codeRequired: false };
    } catch {
      status = { available: false, codeRequired: false };
    }
    return status;
  }

  function showSetup(on, note = '') {
    setup.hidden = !on;
    chat.hidden = on;
    settingsButton.setAttribute('aria-expanded', String(on));
    const available = Boolean(status?.available);
    for (const part of fields) part.hidden = !available;
    for (const part of codeParts) part.hidden = !(available && status.codeRequired);
    offNote.hidden = available || status === null;
    feedback.textContent = note;
    if (!on) input.focus();
    else if (available) (status.codeRequired && !code ? $('assistant-code') : $('assistant-consent')).focus();
  }

  async function open() {
    panel.hidden = false;
    fab.setAttribute('aria-expanded', 'true');
    if (!status?.available) { // not known yet, or off last time: show a short waiting note
      setup.hidden = false;
      chat.hidden = true;
      for (const part of [...fields, ...codeParts]) part.hidden = true;
      offNote.hidden = true;
      feedback.textContent = 'Asistan kontrol ediliyor…';
    }
    await loadStatus(); // asked on every opening, so a change made by the site owner is picked up
    showSetup(!hasAccess());
  }

  function close() {
    panel.hidden = true;
    fab.setAttribute('aria-expanded', 'false');
    controller?.abort();
  }

  function toggle() {
    if (panel.hidden) open();
    else close();
  }

  function message(role, text, extra = null) {
    const bubble = el('div', { class: `assistant__msg assistant__msg--${role}` }, el('p', {}, text));
    if (extra) bubble.append(extra);
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  }

  function relatedButtons(used) {
    if (!used.length) return null;
    const wrap = el('div', { class: 'assistant__related' }, el('span', {}, 'İlgili kartlar:'));
    for (const item of used.slice(0, 4)) {
      const button = el('button', { type: 'button', class: 'chip-btn' }, item.label);
      button.addEventListener('click', () => onShowCard(item.id));
      wrap.append(button);
    }
    return wrap;
  }

  async function ask(question) {
    const text = question.trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || busy) return;
    if (!hasAccess()) { showSetup(true); return; }
    busy = true;
    send.disabled = true;
    $('assistant-suggest').hidden = true;
    message('user', text);
    const pending = message('bot', 'Düşünüyor…');
    pending.classList.add('is-pending');

    const context = buildContext({ question: text, annotations, classes, equivalentsById, sourcesById, currentId: getCurrentId() });
    const body = buildRequest({ question: text, history, context: context.text });
    controller = new AbortController();
    let backToSetup = null;
    try {
      const headers = { 'content-type': 'application/json' };
      if (status.codeRequired) headers['x-access-code'] = code;
      const response = await fetchImpl(CHAT_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      let json = null;
      try { json = await response.json(); } catch { /* not JSON */ }
      if (!response.ok) throw Object.assign(new Error('api'), { status: response.status, code: json?.error });
      const reply = typeof json?.reply === 'string' ? json.reply.trim() : '';
      if (!reply) throw Object.assign(new Error('empty'), { status: 502 });
      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      pending.replaceChildren(el('p', {}, reply));
      const related = relatedButtons(context.used);
      if (related) pending.append(related);
    } catch (error) {
      if (error.name === 'AbortError') {
        pending.remove();
      } else {
        const failedStatus = typeof error.status === 'number' ? error.status : 0;
        const friendly = errorMessage(failedStatus, error.code);
        pending.replaceChildren(el('p', {}, friendly));
        pending.classList.add('is-error');
        if (error.code === 'bad_code') { code = ''; writeSession(CODE_STORAGE, null); backToSetup = friendly; }
        if (error.code === 'unavailable') { status = { available: false, codeRequired: false }; backToSetup = friendly; }
      }
    } finally {
      pending.classList.remove('is-pending');
      busy = false;
      send.disabled = false;
      controller = null;
      log.scrollTop = log.scrollHeight;
    }
    if (backToSetup) showSetup(true, backToSetup);
  }

  function saveSettings() {
    if (!status?.available) return;
    if (status.codeRequired) {
      const typed = $('assistant-code').value.trim();
      if (typed) code = typed;
      if (!code) { feedback.textContent = 'Önce erişim kodunu gir.'; return; }
    }
    if (!$('assistant-consent').checked) { feedback.textContent = 'Devam etmek için gönderim bilgisini okuduğunu işaretle.'; return; }
    if (status.codeRequired) writeSession(CODE_STORAGE, code);
    writeLocal('assistantConsent', true);
    $('assistant-code').value = '';
    showSetup(false);
  }

  function forget() {
    forgetStoredKey();
    code = '';
    $('assistant-code').value = '';
    feedback.textContent = 'Erişim kodu bu sekmeden silindi.';
  }

  function clearChat() {
    history.length = 0;
    log.replaceChildren();
    $('assistant-suggest').hidden = false;
  }

  // Wiring.
  fab.addEventListener('click', toggle);
  $('assistant-close').addEventListener('click', () => { close(); fab.focus(); });
  settingsButton.addEventListener('click', () => showSetup(setup.hidden));
  $('assistant-save').addEventListener('click', saveSettings);
  $('assistant-forget').addEventListener('click', forget);
  $('assistant-clear').addEventListener('click', clearChat);
  $('assistant-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    ask(text);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('assistant-form').requestSubmit();
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); fab.focus(); }
  });
  const suggest = $('assistant-suggest');
  for (const text of SUGGESTIONS) {
    const button = el('button', { type: 'button', class: 'chip-btn' }, text);
    button.addEventListener('click', () => ask(text));
    suggest.append(button);
  }

  return { open, close, toggle, ask, hasAccess, forget, get isOpen() { return !panel.hidden; } };
}
