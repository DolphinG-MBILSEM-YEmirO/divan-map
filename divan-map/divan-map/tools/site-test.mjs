/**
 * Tests the site-wide additions: link-preview and search metadata, the offline support files (manifest, service
 * worker) and the English interface option (js/i18n.js, js/i18n-en.js) in jsdom. Looks are NOT checked here; see README.
 * Run with `node tools/site-test.mjs` (also part of `npm test`).
 */
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const build = (entry, globalName) => buildSync({ entryPoints: [path.join(ROOT, entry)], bundle: true, format: 'iife', globalName, write: false, logLevel: 'warning' }).outputFiles[0].text;

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const SITE = 'https://www.deargear.tools/';

// ------------------------------------------------------------ metadata
for (const page of ['index.html', 'game.html']) {
  const { document } = new JSDOM(read(page)).window;
  const meta = (attr, name) => document.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content');
  const image = meta('property', 'og:image') ?? '';
  check(`${page}: Open Graph title, description, url and image are set`, ['og:title', 'og:description', 'og:url'].every((n) => meta('property', n)) && image.startsWith(SITE));
  check(`${page}: the preview image exists in the project`, existsSync(path.join(ROOT, image.slice(SITE.length))));
  check(`${page}: X/Twitter card is set`, meta('name', 'twitter:card') === 'summary_large_image' && !!meta('name', 'twitter:image'));
  let ld = null;
  try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent); } catch { /* reported below */ }
  check(`${page}: structured data is valid JSON and calls the site a prototype`, ld?.['@context'] === 'https://schema.org' && ld.creativeWorkStatus === 'Prototip');
  check(`${page}: canonical link and manifest are linked`, !!document.querySelector('link[rel="canonical"]') && !!document.querySelector('link[rel="manifest"]'));
}
check('robots.txt keeps crawlers out of the API and names the sitemap', /Disallow: \/api\//.test(read('robots.txt')) && /Sitemap: https:\/\/www\.deargear\.tools\/sitemap\.xml/.test(read('robots.txt')));

// ---------------------------------------------------------- offline support
const manifest = JSON.parse(read('manifest.webmanifest'));
check('the manifest names the app and every icon exists', manifest.name && manifest.lang === 'tr' && manifest.icons.length >= 2 && manifest.icons.every((i) => existsSync(path.join(ROOT, i.src))));
const sw = read('sw.js');
const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
const missing = precache.filter((p) => p !== './' && !existsSync(path.join(ROOT, p)));
check('every file the service worker stores in advance exists', missing.length === 0);
if (missing.length) console.log('  missing:', missing.join(', '));
const scripts = readdirSync(path.join(ROOT, 'js')).map((f) => `js/${f}`);
check('every script of the site is stored for offline use', scripts.every((s) => precache.includes(s)));
check('the service worker never stores the assistant or other sites', /pathname\.startsWith\('\/api\/'\)/.test(sw) && /url\.origin !== self\.location\.origin/.test(sw));

// ------------------------------------------------------------- English
const corpus = [read('index.html'), ...scripts.filter((s) => !s.includes('i18n')).map(read), ...readdirSync(path.join(ROOT, 'data')).map((f) => read(`data/${f}`))]
  .join('\n').replace(/\s+/g, ' ');
const { EN_TEXT } = await import(path.join(ROOT, 'js/i18n-en.js'));
const found = (text) => corpus.includes(text) || corpus.includes(text.replace(/'/g, "\\'"));
const unused = Object.keys(EN_TEXT).filter((key) => {
  if (found(key)) return false;
  const composed = key.match(/^(.+) \((.+)\)$/); // legend lines are built as "label (shape)"
  return !(composed && found(composed[1]) && found(composed[2]));
});
check('every English text still matches a Turkish text of the site', unused.length === 0);
if (unused.length) console.log('  not found:', unused.join(' | '));

const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;
window.eval(build('js/i18n.js', 'I18n'));
const $ = (id) => document.getElementById(id);
const learn = () => $('menu-learn-btn').querySelector('span').textContent;
check('Turkish is the default', document.documentElement.lang === 'tr' && learn() === 'Öğren' && $('btn-lang').getAttribute('aria-pressed') === 'false');
$('btn-lang').click();
await tick();
check('English translates menus, labels and attributes', document.documentElement.lang === 'en' && learn() === 'Learn' && $('search-input').getAttribute('placeholder') === 'Search places, tribes, features' && $('btn-sidebar-close').getAttribute('aria-label') === 'Close the panel');
check('English mode says what stays Turkish', document.querySelector('[data-i18n-note]').hidden === false && /Turkish/.test(document.querySelector('[data-i18n-note]').textContent));
check('the choice is remembered on this device', window.localStorage.getItem('dlt:lang') === '"en"');
$('search-count').textContent = '3 kayıt bulundu.';
const extra = document.createElement('span');
extra.textContent = 'Kaynakta var';
$('results').append(extra);
await tick();
check('text written later by the scripts is translated too', $('search-count').textContent === '3 records found.' && extra.textContent === 'In the sources');
$('assistant-log').append(Object.assign(document.createElement('p'), { textContent: 'Kaynakta var' }));
await tick();
check('the assistant chat is never translated', $('assistant-log').textContent === 'Kaynakta var');
$('btn-lang').click();
await tick();
check('switching back restores the Turkish texts', document.documentElement.lang === 'tr' && learn() === 'Öğren' && $('search-input').getAttribute('placeholder') === 'Yer, boy, unsur ara' && extra.textContent === 'Kaynakta var');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll site checks passed');
process.exit(failed ? 1 : 0);
