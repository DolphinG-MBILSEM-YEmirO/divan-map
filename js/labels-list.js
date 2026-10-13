/**
 * The "Haritadaki yazılar" dialog: every explanation card as a readable, searchable list.
 * It gives keyboard and screen-reader users, and anyone without a mouse, the same content
 * as the hover cards, and lets everyone jump from a list item to its place on the map.
 */
import { ANNOTATION_KIND, ANNOTATION_STATUS, EQUIVALENT_STATUS } from './labels.js';
import { el, normalizeText } from './text.js';

const KIND_ORDER = ['place', 'region', 'river', 'water', 'steppe', 'mountain', 'legend', 'direction', 'note'];

/**
 * @param {object} options
 * @param {HTMLElement} options.body Element the list is rendered into.
 * @param {HTMLInputElement} options.search Filter input.
 * @param {HTMLElement} options.count Live region for the result count.
 * @param {object[]} options.annotations Prepared annotations of data/map-annotations.json.
 * @param {Map<string, object>} options.sourcesById
 * @param {Map<string, object>} options.equivalentsById
 * @param {(id: string) => void} options.onShow Called when "Haritada göster" is pressed.
 * @param {(sourceId: string) => void} options.onOpenSource
 */
export function renderLabelsList({ body, search, count, annotations, sourcesById, equivalentsById, onShow, onOpenSource }) {
  // Duplicate names (the two "Kum" labels) and "(alan)" helpers are listed once.
  const entries = annotations
    .filter((a) => a.layer !== 'area')
    .map((a) => ({ annotation: a, haystack: normalizeText([a.label, ...a.paragraphs].join(' ')) }));

  function itemFor(annotation) {
    const status = ANNOTATION_STATUS[annotation.status];
    const details = el('details', { class: 'labels__item' });
    details.append(
      el(
        'summary',
        {},
        el('span', { class: 'labels__name' }, annotation.label),
        el('span', { class: `labels__status labels__status--${annotation.status}` }, `${status.symbol} ${status.label}`),
      ),
    );
    annotation.paragraphs.forEach((text) => details.append(el('p', {}, text)));
    if (annotation.status === 'label-only') details.append(el('p', { class: 'xcard__nosource' }, status.help));
    const equivalent = annotation.equivalentId ? equivalentsById.get(annotation.equivalentId) : null;
    if (equivalent) {
      const eqStatus = EQUIVALENT_STATUS[equivalent.status];
      details.append(
        el('p', { class: 'labels__equiv' }, el('strong', {}, 'Günümüzdeki karşılığı (araştırmacılara göre): '), equivalent.modern_equivalent, eqStatus ? ` (${eqStatus.symbol} ${eqStatus.label})` : ''),
      );
    }
    if (annotation.sources.length) {
      const list = el('ul', { class: 'xcard__sources' });
      for (const ref of annotation.sources) {
        const source = sourcesById.get(ref.source_id);
        const button = el('button', { type: 'button', class: 'link-btn' }, source?.short ?? source?.title ?? ref.source_id);
        button.addEventListener('click', () => onOpenSource(ref.source_id));
        list.append(el('li', {}, button, ref.locator ? el('span', { class: 'xcard__locator' }, ` · ${ref.locator}`) : null));
      }
      details.append(el('p', { class: 'xcard__label' }, 'Kaynak'), list);
    }
    const show = el('button', { type: 'button', class: 'btn btn--small' }, 'Haritada göster');
    show.addEventListener('click', () => onShow(annotation.id));
    details.append(el('p', {}, show));
    return details;
  }

  function draw() {
    const query = normalizeText(search.value);
    const matching = entries.filter((e) => !query || e.haystack.includes(query));
    body.replaceChildren();
    for (const kind of KIND_ORDER) {
      const group = matching.filter((e) => e.annotation.kind === kind);
      if (!group.length) continue;
      const section = el('section', { class: 'labels__group' }, el('h3', {}, `${ANNOTATION_KIND[kind]} (${group.length})`));
      group.forEach((e) => section.append(itemFor(e.annotation)));
      body.append(section);
    }
    count.textContent = query ? (matching.length ? `${matching.length} açıklama bulundu.` : 'Eşleşen açıklama bulunamadı.') : `${matching.length} açıklama listeleniyor.`;
  }

  search.addEventListener('input', draw);
  draw();
}
