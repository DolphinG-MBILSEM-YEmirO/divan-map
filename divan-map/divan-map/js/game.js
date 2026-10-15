/**
 * Entry point of game.html: "Kâşgarlı'nın Kervanı".
 *
 * A camel caravan walks on the Turkish-labelled redraw of the Dîvân map. The player picks a place name
 * from the cargo and clicks where it is written; the caravan walks there, water is used on the way and
 * refilled in cities and at rivers, and fictional journey events ask map-reading, direction or place
 * questions. Characters and events are fiction (data/game.json says so); everything said about a place
 * comes from its sourced explanation card. Progress stays on this device (storage.js).
 */
import { ANNOTATION_KIND, ANNOTATION_STATUS } from './labels.js';
import { buildCompass, buildStops, compassBearing, directionWord, pickCargo, REVIEW_KEY, WORDS_KEY } from './caravan.js';
import {
  buildDirectionQuestion, buildMapQuestion, buildPlaceQuestion, clampWater, fill, hits, labelAt,
  pickEvent, prepareAnnotations, refillFor, shapeCenter, travelCost,
} from './game-rules.js';
import { createBoard } from './game-board.js';
import { readLocal, writeLocal } from './storage.js';
import { el } from './text.js';

const $ = (id) => document.getElementById(id);
const MAX_TALK = 4;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function addToList(key, id) {
  const list = readLocal(key, []);
  if (Array.isArray(list) && !list.includes(id)) writeLocal(key, [...list, id]);
}

async function boot() {
  let data;
  try {
    const [config, annotations, caravan, game, equivalents] = await Promise.all([
      loadJson('data/config.json'), loadJson('data/map-annotations.json'), loadJson('data/caravan.json'),
      loadJson('data/game.json'), loadJson('data/modern-equivalents.json'),
    ]);
    data = { config, annotations, caravan, game, equivalents };
  } catch (error) {
    console.error(error);
    $('overlay').replaceChildren(el('div', { class: 'g-card' }, el('h2', { id: 'overlay-title' }, 'Oyun yüklenemedi'), el('p', {}, 'Veri dosyaları okunamadı. Sayfayı yenile; sorun sürerse haritaya dön.'), el('a', { class: 'btn btn--primary', href: 'index.html' }, 'Haritaya dön')));
    return;
  }

  const random = Math.random;
  const { settings, characters, lines, events, mapQuestions } = data.game;
  const annotations = prepareAnnotations(data.annotations.annotations);
  const { start, stops } = buildStops(data.caravan, annotations);
  const compass = buildCompass(annotations, data.config.redrawMap.circle);
  const labels = annotations.filter((a) => (a.layer ?? 'label') === 'label');
  const equivalents = new Map(data.equivalents.records.map((r) => [r.id, r]));
  const journeyLength = Math.min(settings.journeyLength, stops.length);

  const g = {
    phase: 'intro', water: settings.waterStart, delivered: [], stars: 0, cargo: [], selectedId: null,
    attempts: 0, position: start.center, used: new Set(), hideNames: false, answers: { right: 0, total: 0 },
  };

  const board = createBoard({ container: $('board'), config: data.config, onClick: (point, radius) => judge(point, radius) });
  $('board-credit').textContent = data.config.redrawMap.credit ?? '';
  $('notice').textContent = data.game.notice;
  $('divan-words').textContent = (data.game.divanWords ?? []).length
    ? ''
    : 'Dîvân kelimeleri bölümü, ekip kaynaklı kelime listesini (kelime, anlam, sayfa) hazırlayınca açılacak. Şimdilik defterde haritadaki yer adları var.';
  const pick = $('pick');
  pick.append(el('option', { value: '' }, 'Bir yer seç…'));
  [...labels].sort((a, b) => a.label.localeCompare(b.label, 'tr')).forEach((a) => pick.append(el('option', { value: a.id }, a.label)));

  // ------------------------------------------------------------ talk and HUD

  const avatar = (who) => {
    const c = characters[who] ?? { initial: '?', color: '#555', name: '' };
    return el('span', { class: 'g-avatar', style: `--c:${c.color}`, 'aria-hidden': 'true' }, c.initial);
  };

  function say(line, values = {}, { tag = null } = {}) {
    const c = characters[line.who] ?? { name: '' };
    const item = el('li', { class: 'g-say' },
      avatar(line.who),
      el('div', { class: 'g-say__bubble' },
        el('span', { class: 'g-say__name' }, c.name, tag ? el('span', { class: 'g-say__tag' }, tag) : null),
        el('p', {}, fill(line.text, values)),
      ),
    );
    const talk = $('talk');
    talk.append(item);
    while (talk.children.length > MAX_TALK) talk.firstElementChild.remove();
    item.scrollIntoView?.({ block: 'nearest' });
  }

  function renderHud() {
    const meter = $('hud-water');
    meter.replaceChildren(...Array.from({ length: settings.waterMax }, (_, i) => el('span', { class: i < g.water ? 'is-full' : '' })));
    meter.setAttribute('aria-valuemax', String(settings.waterMax));
    meter.setAttribute('aria-valuenow', String(g.water));
    meter.classList.toggle('is-low', g.water <= 3);
    $('hud-water-text').textContent = `${g.water} / ${settings.waterMax}`;
    $('hud-delivered').textContent = `${g.delivered.length} / ${journeyLength}`;
    $('hud-stars').textContent = `${g.stars} ★`;
    const words = readLocal(WORDS_KEY, []);
    $('hud-words').textContent = String(Array.isArray(words) ? words.length : 0);
  }

  function renderNotebook() {
    const list = $('notebook');
    list.replaceChildren(...g.delivered.map((id) => {
      const stop = stops.find((s) => s.id === id);
      return el('li', {}, el('strong', {}, stop.label), ` · ${ANNOTATION_KIND[stop.kind] ?? ''}`, el('p', {}, stop.clue));
    }));
    $('notebook-count').textContent = `(${g.delivered.length})`;
  }

  // ------------------------------------------------------------------ cargo

  const current = () => g.cargo.find((s) => s.id === g.selectedId) ?? null;
  const nameOf = (stop) => (g.hideNames ? 'Aradığın yer' : stop.label);

  function cardFor(stop) {
    const annotation = annotations.find((a) => a.id === stop.id);
    const status = ANNOTATION_STATUS[annotation.status];
    return el('details', { class: 'g-cardtext' },
      el('summary', {}, 'Yerin açıklama kartını oku'),
      ...annotation.paragraphs.map((p) => el('p', {}, p)),
      el('p', { class: 'hint' }, `${status?.symbol ?? ''} ${status?.label ?? ''}`),
    );
  }

  function renderCargo() {
    const task = $('task');
    const hard = el('input', { type: 'checkbox', id: 'hard' });
    hard.checked = g.hideNames;
    hard.addEventListener('change', () => { g.hideNames = hard.checked; renderCargo(); });
    const list = el('ul', { class: 'g-cargo', 'aria-label': 'Kervandaki yükler' });
    for (const stop of g.cargo) {
      const button = el('button', { type: 'button', class: 'g-cargo__item', 'aria-pressed': String(stop.id === g.selectedId) },
        el('span', { class: 'g-cargo__name' }, g.hideNames ? '? ? ?' : stop.label),
        el('span', { class: 'g-cargo__kind' }, ANNOTATION_KIND[stop.kind] ?? ''),
        el('span', { class: 'g-cargo__clue' }, stop.clue),
      );
      button.addEventListener('click', () => select(stop.id));
      list.append(el('li', {}, button));
    }
    const parts = [
      el('div', { class: 'g-task__head' }, el('h2', {}, 'Yükler'), el('label', { class: 'g-hard', for: 'hard' }, hard, ' Adları gizle (zor)')),
      list,
    ];
    if (g.attempts >= 2 && current()) parts.push(cardFor(current()));
    task.replaceChildren(...parts);
  }

  function select(id) {
    g.selectedId = id;
    g.attempts = 0;
    board.clearHelp();
    renderCargo();
  }

  function refillCargo() {
    const added = pickCargo(stops, g.used, settings.capacity - g.cargo.length, random);
    added.forEach((s) => g.used.add(s.id));
    g.cargo.push(...added);
  }

  // -------------------------------------------------------------- the rules

  function judge(point, radius, pickedId = null) {
    const stop = current();
    if (g.phase !== 'choose' || !stop) return;
    if (pickedId ? pickedId === stop.id : hits(stop, point, radius)) {
      travel(stop);
      return;
    }
    g.attempts += 1;
    const there = pickedId ? labels.find((a) => a.id === pickedId) : labelAt(labels, point, radius);
    const thereText = there ? `Burası “${there.label}”.` : 'Burada aradığın yazı yok.';
    if (g.attempts === 1 && compass) {
      const from = there ? shapeCenter(there.shapes) : point;
      say(lines.wrongFirst, { there: thereText, direction: directionWord(compassBearing(compass, from, stop.center)) });
    } else {
      board.outline(stop.shapes);
      addToList(REVIEW_KEY, stop.id);
      say(lines.wrongSecond, { there: thereText });
      renderCargo();
    }
  }

  async function travel(stop) {
    g.phase = 'travel';
    const cost = travelCost(g.position, stop.center, settings.pixelsPerWater);
    g.water = clampWater(g.water - cost, settings.waterMax);
    say(lines.travel, { to: nameOf(stop) });
    $('task').replaceChildren(el('p', { class: 'g-walking' }, `Kervan yolda… (−${cost} su)`));
    renderHud();
    board.clearHelp();
    await board.walk(stop.center);
    arrive(stop);
  }

  function arrive(stop) {
    const firstTry = g.attempts === 0;
    if (firstTry) g.stars += 1;
    g.position = stop.center;
    g.delivered.push(stop.id);
    g.cargo = g.cargo.filter((s) => s.id !== stop.id);
    board.flag(stop.center, g.delivered.length, stop.label);
    addToList(WORDS_KEY, stop.id);
    say(lines.arrive, { to: `${stop.label}${firstTry ? ' ★' : ''}`, clue: stop.clue });
    const refill = refillFor(stop.kind, settings);
    if (refill) {
      g.water = clampWater(g.water + refill, settings.waterMax);
      say(stop.kind === 'place' ? lines.refillCity : lines.refillWater, { to: stop.label, amount: refill });
    }
    const equivalent = stop.equivalentId ? equivalents.get(stop.equivalentId) : null;
    if (equivalent?.modern_equivalent && equivalent.status !== 'unidentified') say(lines.equivalent, { modern: equivalent.modern_equivalent });
    renderHud();
    renderNotebook();

    if (g.delivered.length >= journeyLength) return finish('done');
    if (g.water <= 0) return finish('thirsty');
    refillCargo();
    g.selectedId = null;
    select(g.cargo[0]?.id ?? null);
    const event = pickEvent(events, { chance: settings.eventChance, canAskDirection: Boolean(compass && g.cargo.length), canAskPlace: stops.length >= 4 }, random);
    if (event) runEvent(event);
    else toChoose();
  }

  function toChoose() {
    g.phase = 'choose';
    renderCargo();
    say(lines.pick);
  }

  function questionFor(event) {
    if (event.question === 'map') return buildMapQuestion(mapQuestions[Math.floor(random() * mapQuestions.length)], random);
    if (event.question === 'direction') {
      const next = current() ?? g.cargo[0];
      return buildDirectionQuestion(compass, g.position, next.center, next.label, random);
    }
    if (event.question === 'place') {
      const pool = stops.filter((s) => !g.cargo.some((c) => c.id === s.id));
      return buildPlaceQuestion(stops, pool[Math.floor(random() * pool.length)], random);
    }
    return null;
  }

  function applyOutcome(outcome, event) {
    g.water = clampWater(g.water + (outcome?.water ?? 0), settings.waterMax);
    say({ who: event.who, text: outcome?.text ?? '' }, {}, { tag: 'Oyun olayı · kurgu' });
    renderHud();
  }

  function continueButton() {
    const next = el('button', { type: 'button', class: 'btn btn--primary' }, 'Yola devam');
    next.addEventListener('click', () => (g.water <= 0 ? finish('thirsty') : toChoose()));
    return next;
  }

  function runEvent(event) {
    g.phase = 'event';
    say({ who: event.who, text: `${event.title}: ${event.text}` }, {}, { tag: 'Oyun olayı · kurgu' });
    const task = $('task');
    const question = questionFor(event);
    if (!question) {
      applyOutcome(event.right, event);
      task.replaceChildren(el('div', { class: 'g-event' }, el('h2', {}, event.title), el('p', { class: 'g-event__tag' }, 'Oyun olayı · kurgu'), continueButton()));
      continueButtonFocus();
      return;
    }
    const feedback = el('div', { class: 'g-q__feedback', hidden: true });
    const options = el('div', { class: 'g-q__options', role: 'group', 'aria-label': 'Seçenekler' });
    for (const option of question.options) {
      const button = el('button', { type: 'button', class: 'g-q__option', 'data-option': option.id }, option.text);
      button.addEventListener('click', () => {
        const right = option.id === question.correct;
        g.answers.total += 1;
        if (right) g.answers.right += 1;
        else if (question.stopId) addToList(REVIEW_KEY, question.stopId);
        options.querySelectorAll('button').forEach((b) => {
          b.disabled = true;
          if (b.dataset.option === question.correct) b.classList.add('is-right');
          else if (b === button) b.classList.add('is-wrong');
        });
        const correctText = question.options.find((o) => o.id === question.correct).text;
        feedback.replaceChildren(el('strong', {}, right ? 'Doğru.' : `Doğru cevap: ${correctText}.`), el('p', {}, question.explanation), continueButton());
        feedback.hidden = false;
        applyOutcome(right ? event.right : event.wrong, event);
        continueButtonFocus();
      });
      options.append(button);
    }
    task.replaceChildren(el('div', { class: 'g-event' },
      el('h2', {}, event.title),
      el('p', { class: 'g-event__tag' }, 'Oyun olayı · kurgu'),
      el('p', { class: 'g-q__prompt' }, question.prompt),
      options,
      feedback,
    ));
    options.querySelector('button')?.focus();
  }

  function continueButtonFocus() {
    $('task').querySelector('.btn--primary')?.focus();
  }

  // ------------------------------------------------------- start and finish

  function overlay(...children) {
    const box = $('overlay');
    box.replaceChildren(el('div', { class: 'g-card' }, ...children));
    box.hidden = false;
    box.querySelector('.btn--primary')?.focus();
  }

  function showIntro() {
    const startButton = el('button', { type: 'button', class: 'btn btn--primary g-start' }, 'Yolculuğa başla');
    startButton.addEventListener('click', startJourney);
    overlay(
      el('p', { class: 'g-card__eyebrow' }, 'Öğrenme oyunu'),
      el('h2', { id: 'overlay-title' }, data.game.title),
      el('p', { class: 'g-card__lead' }, `Kervan ${start.label}'dan yola çıkıyor. ${journeyLength} yer adını haritada doğru yere götür; suyu idareli kullan.`),
      el('ul', { class: 'g-cast' }, ...Object.entries(characters).map(([who, c]) => el('li', {}, avatar(who), el('div', {}, el('strong', {}, c.name), el('span', {}, c.role))))),
      el('ol', { class: 'g-how' },
        el('li', {}, 'Yüklerden birini seç; yanında yer hakkında bir ipucu var.'),
        el('li', {}, 'Haritada o adın yazılı olduğu yere tıkla. Develer oraya yürür ve su harcar.'),
        el('li', {}, 'Yer adı yazılı konaklarda ve ırmak kıyılarında su tazelenir. Yoldaki olaylarda soruları yanıtla.'),
        el('li', {}, 'İlk denemede yapılan her teslim bir yıldız. Teslim edilen adlar Sözlüğüm\'e yazılır.'),
      ),
      el('p', { class: 'g-card__note' }, data.game.notice),
      startButton,
    );
  }

  function startJourney() {
    $('overlay').hidden = true;
    Object.assign(g, { water: settings.waterStart, delivered: [], stars: 0, cargo: [], selectedId: null, attempts: 0, position: start.center, used: new Set(), answers: { right: 0, total: 0 } });
    board.place(start.center);
    board.fitAll();
    $('talk').replaceChildren();
    lines.intro.forEach((line) => say(line));
    refillCargo();
    select(g.cargo[0].id);
    renderHud();
    renderNotebook();
    g.phase = 'choose';
    $('task').querySelector('button')?.focus();
  }

  function finish(reason) {
    g.phase = 'end';
    say(reason === 'done' ? lines.finish : lines.thirsty);
    board.fitRoute();
    const againInPanel = el('button', { type: 'button', class: 'btn btn--primary' }, 'Yeni yolculuk');
    againInPanel.addEventListener('click', startJourney);
    $('task').replaceChildren(el('div', { class: 'g-event' }, el('h2', {}, reason === 'done' ? 'Yolculuk tamamlandı' : 'Kervan mola verdi'), el('p', {}, `${g.delivered.length} teslim, ${g.stars} ★. Rota haritada çizili.`), againInPanel));
    const again = el('button', { type: 'button', class: 'btn btn--primary' }, 'Yeni yolculuk');
    again.addEventListener('click', startJourney);
    const close = el('button', { type: 'button', class: 'btn' }, 'Rotayı incele');
    close.addEventListener('click', () => { $('overlay').hidden = true; });
    overlay(
      el('p', { class: 'g-card__eyebrow' }, reason === 'done' ? 'Yolculuk tamamlandı' : 'Kervan mola verdi'),
      el('h2', { id: 'overlay-title' }, `${g.delivered.length} teslim, ${g.stars} ★`),
      el('p', { class: 'g-card__lead' }, `Yol sorularında ${g.answers.right} / ${g.answers.total} doğru. Kalan su: ${g.water}.`),
      el('ol', { class: 'g-summary' }, ...g.delivered.map((id) => {
        const stop = stops.find((s) => s.id === id);
        return el('li', {}, el('strong', {}, stop.label), el('span', {}, stop.clue));
      })),
      el('p', { class: 'g-card__note' }, 'Teslim edilen adlar Sözlüğüm\'e, zorlandığın yerler Pekiştirme testine eklendi. İkisi de haritadaki "Pekiştir" menüsünde; yalnızca bu cihazda saklanır.'),
      el('div', { class: 'g-card__buttons' }, again, close, el('a', { class: 'btn', href: 'index.html' }, 'Haritaya dön')),
    );
  }

  // ----------------------------------------------------------------- wiring

  $('pick-go').addEventListener('click', () => {
    if (!pick.value) return;
    const picked = labels.find((a) => a.id === pick.value);
    judge(shapeCenter(picked.shapes), 0, picked.id);
  });
  window.addEventListener('resize', () => board.refresh());

  board.place(start.center);
  renderHud();
  renderNotebook();
  showIntro();

  // Exposed for tests only.
  window.__game = { g, stops, start: startJourney, judgeById: (id) => judge(null, 0, id), finish };
}

boot();
