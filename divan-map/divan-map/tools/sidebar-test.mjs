/**
 * Tests the collapsible side panel (js/sidebar.js) in jsdom: folding, remembering, rail shortcuts, the record count on the
 * rail, and that the ids other code relies on are still in the page. Layout and looks are NOT checked here; see README.
 * Run with `node tools/sidebar-test.mjs` (also part of `npm test`).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = buildSync({ entryPoints: [path.join(ROOT, 'js/sidebar.js')], bundle: true, format: 'iife', write: false, logLevel: 'warning' }).outputFiles[0].text;
const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const html = source.replace(/<script[\s\S]*?<\/script>/g, '');

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function open(beforeRun) {
  const dom = new JSDOM(html, { url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  beforeRun?.(window);
  window.eval(bundle);
  return window;
}

// the page still carries everything other code depends on
{
  const { document } = new JSDOM(html).window;
  const ids = ['sidebar', 'btn-sidebar', 'layout', 'search-form', 'search-input', 'search-count', 'layer-original', 'layer-modern', 'category-filters', 'results', 'results-count', 'results-empty', 'progress', 'progress-fill', 'btn-reset-view', 'btn-sidebar-collapse', 'sidebar-body', 'sidebar-rail', 'rail-count'];
  check('every id used by the app and the panel is present', ids.every((id) => document.getElementById(id)));
  check('the toggle controls the body of the panel', document.getElementById('btn-sidebar-collapse').getAttribute('aria-controls') === 'sidebar-body' && document.getElementById('sidebar').contains(document.getElementById('sidebar-body')));
  check('the map switches are still checkboxes', ['layer-original', 'layer-modern'].every((id) => document.getElementById(id).type === 'checkbox'));
  check('every rail button names a section that exists and has an accessible name', [...document.querySelectorAll('[data-rail-target]')].every((b) => document.getElementById(b.dataset.railTarget) && b.getAttribute('aria-label')));
  check('the page loads the panel stylesheet and script', source.includes('href="css/sidebar.css"') && source.includes('src="js/sidebar.js"'));
}

// folding and unfolding
{
  const window = open();
  const $ = (id) => window.document.getElementById(id);
  let resizes = 0;
  window.addEventListener('resize', () => { resizes += 1; });
  check('the panel starts open', !$('layout').classList.contains('is-rail') && $('btn-sidebar-collapse').getAttribute('aria-expanded') === 'true' && $('btn-sidebar-collapse').getAttribute('aria-label') === 'Paneli daralt');
  $('btn-sidebar-collapse').click();
  check('the button folds the panel into the rail and says so', $('layout').classList.contains('is-rail') && $('btn-sidebar-collapse').getAttribute('aria-expanded') === 'false' && $('btn-sidebar-collapse').getAttribute('aria-label') === 'Paneli genişlet');
  check('the choice is remembered on this device only', JSON.parse(window.localStorage.getItem('dlt:sidebarRail')) === true);
  await tick(450);
  check('the maps are told to resize while the column moves', resizes >= 2);
  $('btn-sidebar-collapse').click();
  check('the button opens the panel again', !$('layout').classList.contains('is-rail') && $('btn-sidebar-collapse').getAttribute('aria-expanded') === 'true' && JSON.parse(window.localStorage.getItem('dlt:sidebarRail')) === false);
}

// rail shortcuts open the panel and move focus
{
  const window = open();
  const $ = (id) => window.document.getElementById(id);
  $('btn-sidebar-collapse').click();
  window.document.querySelector('[data-rail-target="search-input"]').click();
  check('the search shortcut opens the panel and focuses the search field', !$('layout').classList.contains('is-rail') && window.document.activeElement === $('search-input'));
  $('btn-sidebar-collapse').click();
  window.document.querySelector('[data-rail-target="layer-original"]').click();
  check('the maps shortcut focuses the first map switch', !$('layout').classList.contains('is-rail') && window.document.activeElement === $('layer-original'));
}

// the count on the rail follows the list
{
  const window = open();
  const $ = (id) => window.document.getElementById(id);
  $('results-count').textContent = '(5)';
  await tick();
  check('the rail shows the number of records', $('rail-count').textContent === '5');
  $('results-count').textContent = '';
  await tick();
  check('an empty count shows nothing', $('rail-count').textContent === '');
}

// a folded panel is restored at load, without animating
{
  const window = open((w) => w.localStorage.setItem('dlt:sidebarRail', 'true'));
  const $ = (id) => window.document.getElementById(id);
  check('a remembered folded panel starts folded', $('layout').classList.contains('is-rail') && $('btn-sidebar-collapse').getAttribute('aria-expanded') === 'false');
  check('the restored state does not animate', !$('layout').classList.contains('is-animated'));
  await tick(100);
  check('later changes are animated', $('layout').classList.contains('is-animated'));
}

// storage that throws must not break the panel
{
  const window = open((w) => { Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } }); });
  const $ = (id) => window.document.getElementById(id);
  $('btn-sidebar-collapse').click();
  check('the panel still folds when storage is blocked', $('layout').classList.contains('is-rail'));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll sidebar checks passed');
process.exit(failed ? 1 : 0);
