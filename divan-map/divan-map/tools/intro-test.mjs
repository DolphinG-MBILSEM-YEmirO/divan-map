/**
 * Tests the opening screen (js/intro.js) in jsdom: every way of closing it, the inert page behind it, and that it
 * leaves the site directly usable. Animation and looks are NOT checked here; see README.
 * Run with `node tools/intro-test.mjs` (also part of `npm test`).
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = buildSync({ entryPoints: [path.join(ROOT, 'js/intro.js')], bundle: true, format: 'iife', globalName: 'IntroModule', write: false, logLevel: 'warning' }).outputFiles[0].text;
const source = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const html = source.replace(/<script[\s\S]*?<\/script>/g, '');

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens the page, starts the intro and tells when it resolved. */
function start(markup = html) {
  const dom = new JSDOM(markup, { url: 'http://localhost:8000/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.eval(bundle);
  const state = { done: false };
  const promise = window.IntroModule.playIntro().then(() => { state.done = true; });
  return { window, state, promise, $: (id) => window.document.getElementById(id) };
}

// the page itself
{
  const { document } = new JSDOM(html).window;
  check('the opening screen and its two close buttons exist', !!document.getElementById('intro') && !!document.getElementById('intro-skip') && !!document.getElementById('intro-open') && document.querySelectorAll('[data-intro-close]').length === 2);
  check('the screen is a labelled modal dialog', document.getElementById('intro').getAttribute('role') === 'dialog' && document.getElementById('intro').getAttribute('aria-modal') === 'true' && !!document.getElementById(document.getElementById('intro').getAttribute('aria-labelledby')));
  check('the former cover dialog is gone', !document.getElementById('dlg-welcome'));
  check('the page loads the opening stylesheet', source.includes('href="css/opening.css"'));
}

// while it plays, the page behind it is inert; the skip button has focus
{
  const { window, $ } = start();
  check('the page behind the opening screen is inert', [...window.document.body.children].filter((n) => n !== $('intro')).every((n) => n.hasAttribute('inert')));
  check('the skip button has focus', window.document.activeElement === $('intro-skip'));
}

// every way of closing it
for (const [name, act] of [
  ['the "Haritayı aç" button', ({ $ }) => $('intro-open').click()],
  ['the skip button', ({ $ }) => $('intro-skip').click()],
  ['a click anywhere on the screen', ({ $ }) => $('intro').click()],
  ['the Escape key', ({ window }) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))],
  ['the Enter key', ({ window }) => window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }))],
]) {
  const ctx = start();
  act(ctx);
  check(`${name} starts the fade-out and frees the page`, ctx.$('intro').classList.contains('is-leaving') && ![...ctx.window.document.querySelectorAll('[inert]')].length);
  await tick(750);
  check(`${name} removes the screen and resolves`, ctx.$('intro') === null && ctx.state.done);
}

// closing twice is harmless
{
  const ctx = start();
  ctx.$('intro-open').click();
  ctx.$('intro-skip').click();
  await tick(750);
  check('closing twice resolves once and leaves no dialog open', ctx.state.done && !ctx.window.document.querySelector('dialog[open]'));
}

// no markup: resolves at once
{
  const ctx = start('<!doctype html><body><p>no intro here</p></body>');
  await ctx.promise;
  check('without the markup it resolves immediately', ctx.state.done);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll opening screen checks passed');
process.exit(failed ? 1 : 0);
