/**
 * "Find it on the map" activity.
 *
 * Tasks are built from the records and test map-reading skills (for example "find a marker
 * whose location is approximate"), not historical facts. Results stay in memory only.
 */
import { LOCATION_TYPE_META } from './labels.js';

const MAX_NAME_TASKS = 5;

/** Builds the task list from the loaded records. Pure function, easy to test. */
export function buildTasks(records) {
  const tasks = [];
  for (const [type, meta] of Object.entries(LOCATION_TYPE_META)) {
    if (!records.some((r) => r.location_type === type)) continue;
    tasks.push({
      id: `type-${type}`,
      prompt: `Konumu "${meta.label.toLowerCase()}" olan bir kayıt bul. Simgesine tıkla veya listeden seç.`,
      isCorrect: (record) => record.location_type === type,
      hint: `İpucu: bu türün simgesi ${meta.shape}.`,
    });
  }
  records.slice(0, MAX_NAME_TASKS).forEach((record) => {
    tasks.push({
      id: `name-${record.id}`,
      prompt: `"${record.historical_name}" kaydını haritada bul.`,
      isCorrect: (candidate) => candidate.id === record.id,
      hint: 'İpucu: arama kutusunu veya kategori filtrelerini kullanabilirsin.',
    });
  });
  return tasks;
}

export function createActivity({ bar, records }) {
  const prompt = bar.querySelector('[data-activity-prompt]');
  const feedback = bar.querySelector('[data-activity-feedback]');
  const nextButton = bar.querySelector('[data-activity-next]');
  const stopButton = bar.querySelector('[data-activity-stop]');
  let tasks = [];
  let index = 0;
  let score = 0;
  let attempts = 0;
  let solved = false;
  let active = false;

  function show() {
    const task = tasks[index];
    prompt.textContent = `Görev ${index + 1} / ${tasks.length}: ${task.prompt}`;
    feedback.textContent = '';
    nextButton.hidden = true;
    solved = false;
    attempts = 0;
  }

  function finish() {
    prompt.textContent = `Etkinlik bitti: ilk denemede ${score} / ${tasks.length} görev doğru.`;
    feedback.textContent = 'Sonuç yalnızca bu ekranda gösterilir; kaydedilmez.';
    nextButton.hidden = true;
    active = false;
  }

  function start() {
    tasks = buildTasks(records);
    if (!tasks.length) {
      bar.hidden = false;
      prompt.textContent = 'Etkinlik için yeterli kayıt yok.';
      return false;
    }
    index = 0;
    score = 0;
    active = true;
    bar.hidden = false;
    show();
    return true;
  }

  function stop() {
    active = false;
    bar.hidden = true;
  }

  /** Called when the user picks a record. Returns true if the pick was judged. */
  function answer(record) {
    if (!active || solved) return false;
    const task = tasks[index];
    attempts += 1;
    if (task.isCorrect(record)) {
      solved = true;
      if (attempts === 1) score += 1;
      feedback.textContent = `Doğru: ${record.historical_name}.`;
      nextButton.textContent = index + 1 === tasks.length ? 'Sonucu gör' : 'Sonraki görev';
      nextButton.hidden = false;
      nextButton.focus();
    } else {
      feedback.textContent = `Bu kayıt istenen değil (${record.historical_name}). Tekrar dene. ${task.hint}`;
    }
    return true;
  }

  nextButton.addEventListener('click', () => {
    index += 1;
    if (index >= tasks.length) finish();
    else show();
  });
  stopButton.addEventListener('click', stop);

  return { start, stop, answer, isActive: () => active };
}
