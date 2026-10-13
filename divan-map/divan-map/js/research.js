/**
 * DRAFT research instruments: consent gate, pre/post map-reading task, usability survey.
 *
 * Nothing is sent anywhere. Responses are kept in localStorage under an anonymous code the
 * participant chooses (letters and digits only, never a name) and can be exported as CSV.
 * Real use with students needs school/MEB permission and consent forms first (see docs/RESEARCH_DRAFT.md).
 */
import { readLocal, writeLocal } from './storage.js';
import { el } from './text.js';

const STORE_KEY = 'researchRecords';
const CODE_PATTERN = /^[A-Za-z0-9]{4,10}$/;
const PHASE_LABELS = { pre: 'Ön test (Form A)', post: 'Son test (Form B)', survey: 'Kullanılabilirlik anketi' };

export function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds the CSV text for stored records. Pure function. */
export function recordsToCsv(records, instruments) {
  const itemIds = [
    ...instruments.forms.A.items.map((i) => i.id),
    ...instruments.forms.B.items.map((i) => i.id),
    ...instruments.survey.items.map((i) => i.id),
  ];
  const header = ['code', 'phase', 'date', 'score', ...itemIds];
  const rows = records.map((r) => [r.code, r.phase, r.date, r.score ?? '', ...itemIds.map((id) => r.answers?.[id] ?? '')]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

export function createResearch({ container, instruments }) {
  function loadRecords() {
    const stored = readLocal(STORE_KEY, []);
    return Array.isArray(stored) ? stored : [];
  }

  function saveRecord(record) {
    return writeLocal(STORE_KEY, [...loadRecords(), record]);
  }

  // ---- step 1: consent gate
  function start() {
    container.replaceChildren();
    const note = el('p', { class: 'hint' }, instruments.status);
    const checkbox = el('input', { type: 'checkbox', id: 'rs-consent' });
    const message = el('p', { class: 'hint', role: 'alert' });
    const go = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Devam et');
    const form = el(
      'form',
      { novalidate: true },
      ...instruments.consentText.map((t) => el('p', {}, t)),
      el('label', { class: 'quiz-option', for: 'rs-consent' }, checkbox, el('span', {}, 'Bilgilendirmeyi okudum. Gönüllü katılıyorum ve (gerekiyorsa) veli onamı ile okul izni tamamlandı.')),
      message,
      go,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!checkbox.checked) {
        message.textContent = 'Devam etmek için onay kutusunu işaretlemelisin.';
        return;
      }
      chooseTask();
    });
    container.append(note, form);
  }

  // ---- step 2: anonymous code and task
  function chooseTask() {
    container.replaceChildren();
    const code = el('input', { type: 'text', id: 'rs-code', maxlength: '10', autocomplete: 'off', spellcheck: 'false' });
    const phase = el('select', { id: 'rs-phase' });
    Object.entries(PHASE_LABELS).forEach(([value, label]) => phase.append(el('option', { value }, label)));
    const message = el('p', { class: 'hint', role: 'alert' });
    const go = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Başla');
    const form = el(
      'form',
      { novalidate: true },
      el('p', {}, 'Kendine 4-10 karakterlik bir kod seç (harf ve rakam). Adını veya soyadını YAZMA. Ön ve son testte aynı kodu kullan.'),
      el('label', { for: 'rs-code' }, 'Kodun'),
      code,
      el('label', { for: 'rs-phase' }, 'Yapılacak bölüm'),
      phase,
      message,
      go,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!CODE_PATTERN.test(code.value)) {
        message.textContent = 'Kod 4-10 karakter olmalı ve yalnızca harf ve rakam içermelidir.';
        return;
      }
      if (phase.value === 'survey') renderSurvey(code.value);
      else renderTest(code.value, phase.value);
    });
    container.append(form, exportBlock());
  }

  // ---- step 3a: pre / post task
  function renderTest(code, phaseName) {
    container.replaceChildren();
    const formId = phaseName === 'pre' ? 'A' : 'B';
    const spec = instruments.forms[formId];
    const message = el('p', { class: 'hint', role: 'alert' });
    const fields = spec.items.map((item) => {
      const set = el('fieldset', { class: 'quiz-q' }, el('legend', {}, item.prompt));
      item.options.forEach((option) => {
        const input = el('input', { type: 'radio', name: item.id, value: option.id, id: `${item.id}-${option.id}` });
        set.append(el('label', { class: 'quiz-option', for: input.id }, input, el('span', {}, option.text)));
      });
      return { item, set };
    });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Bitir');
    const form = el('form', { novalidate: true }, el('h3', {}, spec.title), ...fields.map((f) => f.set), message, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const answers = {};
      let score = 0;
      for (const { item, set } of fields) {
        const chosen = set.querySelector('input:checked');
        if (!chosen) {
          message.textContent = 'Lütfen tüm soruları yanıtla.';
          return;
        }
        answers[item.id] = chosen.value;
        if (chosen.value === item.correct) score += 1;
      }
      finish({ code, phase: phaseName, date: new Date().toISOString().slice(0, 10), score, answers });
    });
    container.append(form);
  }

  // ---- step 3b: usability survey
  function renderSurvey(code) {
    container.replaceChildren();
    const spec = instruments.survey;
    const message = el('p', { class: 'hint', role: 'alert' });
    const fields = spec.items.map((item) => {
      const set = el('fieldset', { class: 'quiz-q' }, el('legend', {}, item.prompt));
      spec.scale.forEach((label, i) => {
        const input = el('input', { type: 'radio', name: item.id, value: String(i + 1), id: `${item.id}-${i + 1}` });
        set.append(el('label', { class: 'quiz-option', for: input.id }, input, el('span', {}, `${i + 1} - ${label}`)));
      });
      return { item, set };
    });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Bitir');
    const form = el('form', { novalidate: true }, el('h3', {}, spec.title), ...fields.map((f) => f.set), message, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const answers = {};
      for (const { item, set } of fields) {
        const chosen = set.querySelector('input:checked');
        if (!chosen) {
          message.textContent = 'Lütfen tüm maddeleri yanıtla.';
          return;
        }
        answers[item.id] = chosen.value;
      }
      finish({ code, phase: 'survey', date: new Date().toISOString().slice(0, 10), score: null, answers });
    });
    container.append(form);
  }

  function finish(record) {
    const saved = saveRecord(record);
    container.replaceChildren();
    const heading = el('h3', { tabindex: '-1' }, 'Teşekkürler, yanıtların kaydedildi.');
    const again = el('button', { type: 'button', class: 'btn' }, 'Başka bir bölüme geç');
    again.addEventListener('click', chooseTask);
    container.append(
      heading,
      el('p', { class: 'hint' }, saved ? 'Yanıtların yalnızca bu cihazda saklandı.' : 'Yanıtlar bu tarayıcıda saklanamadı.'),
      again,
      exportBlock(),
    );
    heading.focus();
  }

  // ---- export and delete (always visible, so participants can take their data or remove it)
  function exportBlock() {
    const count = loadRecords().length;
    const exportButton = el('button', { type: 'button', class: 'btn' }, `CSV dosyasını indir (${count} kayıt)`);
    const deleteButton = el('button', { type: 'button', class: 'btn' }, 'Bu cihazdaki test kayıtlarını sil');
    const status = el('p', { class: 'hint', role: 'status' });
    // Some embedded viewers block file downloads, so the CSV is also shown as copyable text.
    const csvBox = el('textarea', { readonly: true, rows: '5', hidden: true, 'aria-label': 'CSV metni (kopyalanabilir)' });
    exportButton.addEventListener('click', () => {
      const csv = recordsToCsv(loadRecords(), instruments);
      csvBox.value = csv;
      csvBox.hidden = false;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = el('a', { href: url, download: 'dlt-test-kayitlari.csv' });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
    deleteButton.addEventListener('click', () => {
      writeLocal(STORE_KEY, []);
      status.textContent = 'Test kayıtları silindi.';
      exportButton.textContent = 'CSV dosyasını indir (0 kayıt)';
    });
    return el('div', { class: 'dialog__actions' }, exportButton, deleteButton, status, csvBox);
  }

  return { start, loadRecords };
}
