/**
 * Mini quiz: one question at a time, immediate feedback, local-only result.
 * The result contains no personal data (quiz id, score, total, date).
 */
import { readLocal, writeLocal } from './storage.js';
import { el } from './text.js';

export function createQuiz({ container, quiz }) {
  let index = 0;
  let score = 0;

  function start() {
    index = 0;
    score = 0;
    render();
  }

  function render() {
    container.replaceChildren();
    if (index >= quiz.questions.length) {
      renderSummary();
      return;
    }
    const question = quiz.questions[index];
    const total = quiz.questions.length;

    const feedback = el('div', { class: 'quiz-feedback', tabindex: '-1', hidden: true });
    const message = el('p', { class: 'hint', role: 'alert' });
    const checkButton = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Cevabı kontrol et');
    const nextButton = el(
      'button',
      { type: 'button', class: 'btn btn--primary', hidden: true },
      index + 1 === total ? 'Sonucu gör' : 'Sonraki soru',
    );

    const fieldset = el('fieldset', { class: 'quiz-q' }, el('legend', {}, question.prompt));
    const inputs = [];
    for (const option of question.options) {
      const input = el('input', { type: 'radio', name: question.id, value: option.id, id: `${question.id}-${option.id}` });
      inputs.push(input);
      fieldset.append(el('label', { class: 'quiz-option', for: input.id }, input, el('span', {}, option.text)));
    }

    const form = el('form', { novalidate: true }, fieldset, message, checkButton, nextButton, feedback);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const chosen = inputs.find((input) => input.checked);
      if (!chosen) {
        message.textContent = 'Önce bir seçenek işaretle.';
        return;
      }
      message.textContent = '';
      const correct = chosen.value === question.correct;
      if (correct) score += 1;
      inputs.forEach((input) => {
        input.disabled = true;
        const label = input.closest('label');
        if (input.value === question.correct) label.classList.add('is-correct');
        else if (input === chosen) label.classList.add('is-wrong');
      });
      const correctText = question.options.find((option) => option.id === question.correct).text;
      feedback.replaceChildren(
        el('strong', {}, correct ? 'Doğru.' : `Yanlış. Doğru cevap: ${correctText}`),
        el('p', {}, question.explanation),
      );
      feedback.hidden = false;
      checkButton.hidden = true;
      nextButton.hidden = false;
      feedback.focus();
    });
    nextButton.addEventListener('click', () => {
      index += 1;
      render();
    });

    container.append(el('p', { class: 'quiz-progress' }, `Soru ${index + 1} / ${total}`), form);
  }

  function renderSummary() {
    const total = quiz.questions.length;
    const saved = writeLocal('quizResult', { quizId: quiz.id, score, total, date: new Date().toISOString().slice(0, 10) });
    const again = el('button', { type: 'button', class: 'btn btn--primary' }, 'Testi yeniden çöz');
    again.addEventListener('click', start);
    const heading = el('h3', { tabindex: '-1' }, `${score} / ${total} doğru`);
    container.append(
      heading,
      el('p', {}, 'Yanlış yaptığın soruların açıklamalarını okuyup tekrar deneyebilirsin.'),
      el('p', { class: 'hint' }, saved ? 'Sonucun yalnızca bu cihazda saklandı.' : 'Sonuç bu tarayıcıda saklanamadı.'),
      again,
    );
    heading.focus();
  }

  /** Last stored result, or null. */
  function lastResult() {
    return readLocal('quizResult', null);
  }

  return { start, lastResult };
}
