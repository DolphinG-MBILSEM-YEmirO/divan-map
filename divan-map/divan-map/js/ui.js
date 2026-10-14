/**
 * DOM rendering helpers: results list, category filters, info card, legend and sources.
 * All record text goes through textContent (via el()), never innerHTML.
 */
import {
  CATEGORY_META,
  EQUIVALENT_STATUS,
  CONFIDENCE_META,
  FEATURE_TYPE_LABELS,
  LOCATION_TYPE_META,
  SOURCE_GROUP_LABELS,
} from './labels.js';
import { el } from './text.js';

/** A static copy of a map marker, for badges and the legend. */
export function markerSample(locationType, category) {
  const meta = CATEGORY_META[category];
  return el(
    'span',
    { class: `mk mk--sample mk--${locationType}`, style: `--c: var(${meta.cssVar})`, 'aria-hidden': 'true' },
    el('span', { class: 'mk__glyph' }, meta.glyph),
  );
}

function categorySwatch(category) {
  const meta = CATEGORY_META[category];
  return el('span', { class: 'swatch', style: `--c: var(${meta.cssVar})`, 'aria-hidden': 'true' }, meta.glyph);
}

/**
 * Renders the category checkboxes.
 * Categories without any record are disabled and say why (e.g. routes need sources).
 */
export function renderCategoryFilters(container, { counts, enabled, onChange }) {
  container.replaceChildren();
  const unavailable = [];
  for (const [category, meta] of Object.entries(CATEGORY_META)) {
    const available = (counts[category] ?? 0) > 0;
    const input = el('input', { type: 'checkbox', id: `cat-${category}`, disabled: !available });
    input.checked = available && enabled.has(category);
    input.addEventListener('change', () => onChange(category, input.checked));
    const label = el(
      'label',
      { class: `chip${available ? '' : ' chip--disabled'}`, for: `cat-${category}` },
      input,
      categorySwatch(category),
      el('span', {}, meta.label),
      available ? el('b', { class: 'chip__count' }, String(counts[category])) : null,
    );
    container.append(label);
    if (!available) unavailable.push(category);
  }
  if (unavailable.length) {
    const reasons = unavailable.map((category) => (category === 'route' ? 'Güzergâh: kaynakla desteklenen kayıt olmadığı için kapalı.' : `${CATEGORY_META[category].label}: henüz kayıt yok.`));
    container.append(el('p', { class: 'hint chips__note' }, reasons.join(' ')));
  }
}

/** Renders the accessible record list shown beside the map. */
export function renderResults(listEl, records, { selectedId, onPick }) {
  listEl.replaceChildren();
  for (const record of records) {
    const meta = CATEGORY_META[record.category];
    const button = el(
      'button',
      { type: 'button', class: 'results__item', 'aria-current': record.id === selectedId ? 'true' : 'false' },
      categorySwatch(record.category),
      el(
        'span',
        { class: 'results__text' },
        el('span', { class: 'results__name' }, record.historical_name),
        el('span', { class: 'results__meta' }, `${meta.singular} • ${LOCATION_TYPE_META[record.location_type].label}${record.is_demo ? ' • örnek içerik' : ''}`),
      ),
    );
    button.addEventListener('click', () => onPick(record.id, button));
    listEl.append(el('li', {}, button));
  }
}

function badge(...children) {
  return el('span', { class: 'badge' }, ...children);
}

/**
 * Renders the information card of one record.
 * @param {HTMLElement} cardEl
 * @param {object} record
 * @param {object} ctx { sourcesById, notes: string[], onClose, onOpenSource }
 */
export function renderInfoCard(cardEl, record, { sourcesById, notes, onClose, onOpenSource }) {
  const catMeta = CATEGORY_META[record.category];
  const locMeta = LOCATION_TYPE_META[record.location_type];
  const confMeta = CONFIDENCE_META[record.confidence];
  const kind = record.feature_type ? `${catMeta.singular} • ${FEATURE_TYPE_LABELS[record.feature_type]}` : catMeta.singular;

  const closeButton = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bilgi kartını kapat' }, '×');
  closeButton.addEventListener('click', onClose);

  const title = el('h2', { id: 'card-title', tabindex: '-1' }, record.historical_name);

  const parts = [
    el('div', { class: 'card__head' }, el('div', {}, el('p', { class: 'card__kind' }, kind), title), closeButton),
  ];

  if (record.is_demo) {
    parts.push(
      el('p', { class: 'card__demo' }, 'Örnek içerik: Bu kayıt arayüzü göstermek için eklenmiştir. Gerçek tarihî veri değildir.'),
    );
  }

  parts.push(
    el(
      'div',
      { class: 'card__badges' },
      badge(markerSample(record.location_type, record.category), locMeta.label),
      badge(confMeta.label),
    ),
    el('p', { class: 'card__note' }, locMeta.help),
  );
  if (record.uncertainty_radius_km) {
    parts.push(
      el(
        'p',
        { class: 'card__note' },
        `Günümüz haritasında gösterilen alanın yarıçapı yaklaşık ${record.uncertainty_radius_km} km'dir. Yer bu alanın içinde herhangi bir yerde olabilir.`,
      ),
    );
  }
  parts.push(el('p', { class: 'card__note' }, confMeta.help));

  parts.push(
    el(
      'dl',
      { class: 'card__facts' },
      el('dt', {}, 'Alternatif yazımlar'),
      el('dd', {}, record.alt_spellings.length ? record.alt_spellings.join(', ') : 'Belirtilmemiş'),
      el('dt', {}, 'Yaklaşık günümüz karşılığı'),
      el('dd', {}, record.modern_name ?? 'Belirlenmemiş'),
      el('dt', {}, 'İlgili boy veya topluluk'),
      el('dd', {}, record.related_group ?? 'Belirtilmemiş'),
    ),
    el('h3', {}, 'Açıklama'),
    el('p', {}, record.description),
  );

  parts.push(el('h3', {}, 'Kaynaklar'));
  if (record.sources.length === 0) {
    parts.push(
      el('p', { class: 'card__note' }, record.is_demo ? 'Örnek kayıt olduğu için kaynak yok.' : 'Bu kayıt için kaynak belirtilmemiş.'),
    );
  } else {
    const list = el('ul', { class: 'card__list' });
    for (const ref of record.sources) {
      const source = sourcesById.get(ref.source_id);
      const item = el('li', {});
      const link = el('button', { type: 'button', class: 'link-btn' }, source ? source.title : ref.source_id);
      link.addEventListener('click', () => onOpenSource(ref.source_id));
      item.append(link);
      if (ref.locator) item.append(`, ${ref.locator}`);
      list.append(item);
    }
    parts.push(list);
  }

  if (record.editor_note) parts.push(el('p', { class: 'card__note' }, `Editör notu: ${record.editor_note}`));
  for (const note of notes) parts.push(el('p', { class: 'card__note' }, note));
  parts.push(el('p', { class: 'card__note' }, `Son güncelleme: ${record.last_updated}`));

  cardEl.replaceChildren(...parts);
  cardEl.setAttribute('aria-labelledby', 'card-title');
  return title;
}

/** Legend of marker shapes, categories and confidence levels. */
export function renderLegend(container) {
  container.replaceChildren();

  const shapes = el('ul', { class: 'legend-list' });
  for (const [type, meta] of Object.entries(LOCATION_TYPE_META)) {
    shapes.append(
      el('li', {}, markerSample(type, 'place'), el('div', {}, el('strong', {}, `${meta.label} (${meta.shape})`), el('span', {}, meta.help))),
    );
  }

  const categories = el('ul', { class: 'legend-list' });
  for (const [category, meta] of Object.entries(CATEGORY_META)) {
    categories.append(el('li', {}, categorySwatch(category), el('div', {}, el('strong', {}, meta.label))));
  }

  const confidence = el('ul', { class: 'legend-list' });
  for (const [, meta] of Object.entries(CONFIDENCE_META)) {
    confidence.append(el('li', {}, el('div', {}, el('strong', {}, meta.label), el('span', {}, meta.help))));
  }

  container.append(
    el('h3', {}, 'Simgenin şekli: konum ne kadar kesin?'),
    shapes,
    el('h3', {}, 'Renk ve harf: kayıt türü'),
    categories,
    el('h3', {}, 'Güven düzeyi'),
    confidence,
  );
}

/** Bibliography list grouped by source type. */
export function renderSources(container, sources) {
  container.replaceChildren();
  const groups = new Map();
  for (const source of sources) {
    if (!groups.has(source.group)) groups.set(source.group, []);
    groups.get(source.group).push(source);
  }
  for (const [group, items] of groups) {
    container.append(el('h3', {}, SOURCE_GROUP_LABELS[group] ?? group));
    for (const source of items) {
      const block = el(
        'article',
        { class: 'source', id: `source-${source.id}` },
        el('h4', {}, source.title),
        el('p', {}, [source.author, source.publisher, source.year].filter(Boolean).join(' • ')),
      );
      if (source.role) block.append(el('p', {}, source.role));
      if (source.url) block.append(el('p', {}, el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }, source.url)));
      if (!source.citation_verified) block.append(el('p', { class: 'hint' }, 'Künye doğrulanacak: yayın bilgileri henüz kaynaktan teyit edilmedi.'));
      container.append(block);
    }
  }
}

/** Glossary as a description list. Text is set with textContent only. */
export function renderGlossary(container, terms) {
  container.replaceChildren();
  for (const item of terms) {
    container.append(el('dt', { id: `term-${item.id}` }, item.term), el('dd', {}, item.definition));
  }
}

/** "Where are the places today?" findings: intro text plus an accessible table. */
export function renderEquivalents(container, data, sourcesById, onOpenSource, { plottedIds = new Set(), onShowOnMap = null } = {}) {
  container.replaceChildren();
  data.summary.forEach((text) => container.append(el('p', {}, text)));
  container.append(el('p', { class: 'hint' }, data.scopeNote), el('p', { class: 'card__demo' }, data.verificationNote));

  const legend = el('ul', { class: 'status-legend', 'aria-label': 'Durum açıklamaları' });
  Object.values(EQUIVALENT_STATUS).forEach((s) => legend.append(el('li', {}, el('span', { class: 'status-symbol', 'aria-hidden': 'true' }, s.symbol), s.label)));
  container.append(legend);

  const head = el('tr', {}, ...['Haritadaki/eserdeki ad', 'Önerilen günümüz karşılığı', 'Durum', 'Kaynak'].map((t) => el('th', { scope: 'col' }, t)));
  const body = el('tbody');
  for (const record of data.records) {
    const status = EQUIVALENT_STATUS[record.status];
    const sourceCell = el('td');
    record.sources.forEach((ref, i) => {
      const source = sourcesById.get(ref.source_id);
      const button = el('button', { type: 'button', class: 'link-btn' }, source ? source.title : ref.source_id);
      button.addEventListener('click', () => onOpenSource(ref.source_id));
      if (i > 0) sourceCell.append(el('br'));
      sourceCell.append(button, el('span', { class: 'hint' }, ` (${ref.locator})`));
    });
    const modern = el('td', {}, record.modern_equivalent);
    if (record.note) modern.append(el('br'), el('span', { class: 'hint' }, record.note));
    const nameCell = el('th', { scope: 'row' }, record.historical_name);
    if (onShowOnMap && plottedIds.has(record.id)) {
      const show = el('button', { type: 'button', class: 'btn btn--small equiv-table__show' }, 'Günümüz haritasında göster');
      show.addEventListener('click', () => onShowOnMap(record.id));
      nameCell.append(el('br'), show);
    }
    body.append(el('tr', {}, nameCell, modern, el('td', {}, el('span', { class: 'status-symbol', 'aria-hidden': 'true' }, status.symbol), ` ${status.label}`), sourceCell));
  }
  const wrap = el('div', { class: 'table-wrap' }, el('table', { class: 'equiv-table' }, el('caption', {}, 'Önerilen günümüz karşılıkları'), el('thead', {}, head), body));
  container.append(wrap);
}
