/**
 * Collapsible side panel (desktop only; on a phone the panel is already a drawer).
 *
 * The panel folds into a narrow rail of shortcuts so the maps get more room. A rail button opens the panel and
 * moves focus to its section. The choice is remembered on this device ("sidebarRail", see storage.js).
 *
 * This file does not touch the maps' code: while the column animates it fires `resize` events, which Leaflet
 * listens to, so both maps keep filling their pane. Without JavaScript the panel simply stays open.
 */
import { readLocal, writeLocal } from './storage.js';

const KEY = 'sidebarRail';
const ANIMATION_MS = 350;

function focusSection(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const direct = target.matches('input, button, a[href], [tabindex]');
  const inner = direct ? target : target.querySelector('input, button, a[href], [tabindex]');
  (inner ?? target).focus?.();
  (inner ?? target).scrollIntoView?.({ block: 'nearest' });
}

export function initSidebarRail() {
  const layout = document.getElementById('layout');
  const toggle = document.getElementById('btn-sidebar-collapse');
  const rail = document.getElementById('sidebar-rail');
  if (!layout || !toggle || !rail) return;

  let frame = 0;
  /** Keeps the map canvases the right size for the length of the column animation. */
  const keepMapsFitting = () => {
    const end = performance.now() + ANIMATION_MS;
    const step = () => {
      window.dispatchEvent(new Event('resize'));
      if (performance.now() < end) frame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(step);
  };

  const set = (collapsed, { remember = true, animate = true } = {}) => {
    layout.classList.toggle('is-rail', collapsed);
    const label = collapsed ? 'Paneli genişlet' : 'Paneli daralt';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    if (remember) writeLocal(KEY, collapsed);
    if (animate) keepMapsFitting();
  };

  toggle.addEventListener('click', () => set(!layout.classList.contains('is-rail')));
  rail.addEventListener('click', (event) => {
    const button = event.target.closest('[data-rail-target]');
    if (!button) return;
    set(false);
    focusSection(button.dataset.railTarget);
  });

  // The record count on the rail follows the list's own count, e.g. "(3)".
  const source = document.getElementById('results-count');
  const badge = document.getElementById('rail-count');
  if (source && badge) {
    const sync = () => { badge.textContent = (source.textContent.match(/\d+/) ?? [''])[0]; };
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
    sync();
  }

  set(readLocal(KEY, false) === true, { remember: false, animate: false });
  // Animate only later changes, not the state restored at load.
  requestAnimationFrame(() => requestAnimationFrame(() => layout.classList.add('is-animated')));
}

initSidebarRail();
