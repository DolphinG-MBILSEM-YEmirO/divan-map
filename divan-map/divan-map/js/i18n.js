/**
 * English interface option.
 *
 * Turkish stays the default and the source text. When English is chosen ("lang" on this device, see storage.js),
 * text nodes and a few attributes (aria-label, title, placeholder, data-tip, alt) whose whole Turkish text is in
 * the dictionary (i18n-en.js) are replaced; a MutationObserver does the same for text the scripts write later.
 * Switching back restores every replaced text that the scripts have not changed since.
 * Content that is checked against Turkish sources (explanation cards, sources, glossary, the game) is not
 * translated; elements marked data-i18n-skip are never touched (for example the assistant's chat log).
 */
import { readLocal, writeLocal } from './storage.js';
import { EN_TEXT, EN_PATTERNS, EN_NOTE } from './i18n-en.js';

const KEY = 'lang';
const ATTRS = ['aria-label', 'title', 'placeholder', 'data-tip', 'alt'];
const SKIP = 'script, style, textarea, [data-i18n-skip]';

let current = 'tr';
let observer = null;
const changed = new Map(); // node or `attr` record -> { original, english }
const turkishTitle = document.title;

/** English for a Turkish text, or null when the text is not in the dictionary. */
export function toEnglish(text) {
  const key = text.replace(/\s+/g, ' ').trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(EN_TEXT, key)) return EN_TEXT[key];
  for (const [pattern, make] of EN_PATTERNS) {
    const match = key.match(pattern);
    const english = match ? make(...match.slice(1)) : null;
    if (english !== null) return english;
  }
  // "Yer adı • Yaklaşık konum • örnek içerik": translate the parts that are known.
  if (key.includes(' • ')) {
    const parts = key.split(' • ');
    const english = parts.map((part) => toEnglish(part));
    if (english.some(Boolean)) return parts.map((part, i) => english[i] ?? part).join(' • ');
  }
  return null;
}

function skipped(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return !element || !!element.closest(SKIP);
}

function translateText(node) {
  if (skipped(node)) return;
  const english = toEnglish(node.data);
  if (english === null) return;
  const lead = node.data.match(/^\s*/)[0];
  const trail = node.data.match(/\s*$/)[0];
  const value = `${lead}${english}${trail}`;
  if (value === node.data) return;
  changed.set(node, { original: node.data, english: value });
  node.data = value;
}

function translateAttributes(element) {
  if (skipped(element)) return;
  ATTRS.forEach((name) => {
    const value = element.getAttribute(name);
    if (!value) return;
    const english = toEnglish(value);
    if (english === null || english === value) return;
    changed.set(`${name}\u0000${changed.size}`, { element, name, original: value, english });
    element.setAttribute(name, english);
  });
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || skipped(root)) return;
  translateAttributes(root);
  root.querySelectorAll('*').forEach(translateAttributes);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) translateText(node);
}

function restore() {
  changed.forEach((record, key) => {
    if (typeof key === 'string') {
      if (record.element.getAttribute(record.name) === record.english) record.element.setAttribute(record.name, record.original);
    } else if (key.data === record.english) key.data = record.original;
  });
  changed.clear();
}

function observe() {
  observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree);
      else if (m.type === 'characterData') translateText(m.target);
      else if (m.type === 'attributes') translateAttributes(m.target);
    });
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

export function currentLanguage() {
  return current;
}

/** Switches the interface language ('tr' or 'en') and remembers the choice on this device. */
export function setLanguage(lang, { remember = true } = {}) {
  const next = lang === 'en' ? 'en' : 'tr';
  if (remember) writeLocal(KEY, next);
  const button = document.getElementById('btn-lang');
  button?.setAttribute('aria-pressed', String(next === 'en'));
  document.querySelectorAll('[data-i18n-note]').forEach((note) => { note.hidden = next !== 'en'; });
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  if (next === 'en') {
    translateTree(document.body);
    document.title = toEnglish(turkishTitle) ?? turkishTitle;
    if (!observer) observe();
  } else {
    observer?.disconnect();
    observer = null;
    restore();
    document.title = turkishTitle;
  }
}

export function initLanguage() {
  document.querySelectorAll('[data-i18n-note]').forEach((note) => { note.textContent = EN_NOTE; });
  document.getElementById('btn-lang')?.addEventListener('click', () => setLanguage(current === 'en' ? 'tr' : 'en'));
  setLanguage(readLocal(KEY, 'tr'), { remember: false });
}

initLanguage();
