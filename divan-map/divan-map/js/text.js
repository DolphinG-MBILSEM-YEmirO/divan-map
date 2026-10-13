/**
 * Text helpers.
 */

/**
 * Normalises text for forgiving Turkish search: lower-cases with Turkish rules,
 * removes diacritics (â, î, û, ş, ğ, ç, ö, ü ...) and folds dotless ı to i.
 * "Dîvân" and "divan" therefore match each other.
 */
export function normalizeText(value) {
  return String(value ?? '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .trim();
}

/** Builds a DOM element: el('p', { class: 'x', 'aria-hidden': 'true' }, 'text', childNode) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
