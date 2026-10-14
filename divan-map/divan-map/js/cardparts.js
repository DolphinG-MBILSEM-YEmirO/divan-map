/**
 * Pieces shared by the floating explanation cards of both maps:
 * the source list and the placement of a card beside (never over) the pointer.
 */
import { el } from './text.js';

/**
 * Builds the "Kaynak" block of a card.
 * @param {{source_id: string, locator?: string}[]} refs
 * @param {Map<string, object>} sourcesById
 * @param {(sourceId: string) => void} onOpenSource
 */
export function buildSourceBlock(refs, sourcesById, onOpenSource) {
  if (!refs?.length) return null;
  const list = el('ul', { class: 'xcard__sources' });
  let unverified = false;
  for (const ref of refs) {
    const source = sourcesById.get(ref.source_id);
    const name = source?.short ?? source?.title ?? ref.source_id;
    if (source && source.citation_verified === false) unverified = true;
    const button = el('button', { type: 'button', class: 'link-btn', 'aria-label': `Kaynakçada aç: ${name}` }, name);
    button.addEventListener('click', () => onOpenSource(ref.source_id));
    list.append(el('li', {}, button, ref.locator ? el('span', { class: 'xcard__locator' }, ` · ${ref.locator}`) : null));
  }
  return el(
    'div',
    { class: 'xcard__block' },
    el('p', { class: 'xcard__label' }, 'Kaynak'),
    list,
    unverified ? el('p', { class: 'xcard__fine' }, 'Künyesi “doğrulanacak” olan kaynakların yayın bilgileri ve sayfa numaraları henüz teyit edilmemiştir.') : null,
  );
}

/**
 * Places a card in one of the two side columns of a map pane, on the side the pointer is NOT in,
 * so the spot being explained always stays visible. The card changes sides only when the pointer
 * would otherwise end up under it. Narrow panes and touch screens use a sheet at the top or bottom edge.
 *
 * @param {object} options
 * @param {HTMLElement} options.card The card element (child of `pane`).
 * @param {HTMLElement} options.pane Positioned ancestor of the card.
 * @param {HTMLElement} options.container The map canvas inside the pane.
 * @param {{x: number, y: number}} options.point Pointer position inside the container.
 * @param {boolean} options.touchOnly True on devices without hover.
 * @param {{side: 'left'|'right'|null}} options.memory Remembers the current side between calls.
 */
export function placeBeside({ card, pane, container, point, touchOnly, memory }) {
  const offsetLeft = container.offsetLeft;
  const offsetTop = container.offsetTop;
  const canvasWidth = container.clientWidth;
  const canvasHeight = container.clientHeight;
  const sheet = pane.clientWidth < 420 || touchOnly;
  card.classList.toggle('xcard--sheet', sheet);

  if (sheet) {
    // A sheet takes at most 44 % of the canvas, on the edge the pointer is not near (the split is at 56 %),
    // so the pointer can never end up under it.
    const sheetHeight = Math.round(canvasHeight * 0.44);
    const pointerLow = point.y > canvasHeight * 0.56;
    const belowCanvas = pane.clientHeight - offsetTop - canvasHeight;
    card.style.width = '';
    card.style.left = '';
    card.style.maxHeight = `${sheetHeight}px`;
    card.style.top = pointerLow ? `${offsetTop + 6}px` : '';
    card.style.bottom = pointerLow ? '' : `${belowCanvas + 6}px`;
    return;
  }

  const margin = 8;
  const width = Math.round(Math.min(352, Math.max(240, canvasWidth * 0.44)));
  card.style.width = `${width}px`;
  card.style.bottom = '';
  card.style.top = `${offsetTop + margin}px`;
  card.style.maxHeight = `${Math.max(120, canvasHeight - margin * 2)}px`;

  const spans = {
    left: [margin, margin + width],
    right: [canvasWidth - margin - width, canvasWidth - margin],
  };
  const clear = 14; // keep this much space between the pointer and the card
  const covers = (side) => point.x > spans[side][0] - clear && point.x < spans[side][1] + clear;
  if (!memory.side) memory.side = point.x > canvasWidth / 2 ? 'left' : 'right';
  if (covers(memory.side)) {
    const other = memory.side === 'left' ? 'right' : 'left';
    // If both sides would cover the pointer (a very narrow pane), take the side the pointer is farther from.
    memory.side = !covers(other) || Math.abs(point.x - (spans[other][0] + spans[other][1]) / 2) > Math.abs(point.x - (spans[memory.side][0] + spans[memory.side][1]) / 2) ? other : memory.side;
  }
  card.style.left = `${offsetLeft + spans[memory.side][0]}px`;
}

/** Marks a card as clipped (taller than its box) so CSS can show a "pin to read all" hint. */
export function markClipped(card, isPinned) {
  card.classList.toggle('is-clipped', !isPinned && card.scrollHeight > card.clientHeight + 2);
}
