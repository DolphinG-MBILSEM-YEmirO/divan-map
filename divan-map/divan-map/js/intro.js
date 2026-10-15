/**
 * Opening screen: the school's animation and the former cover in one view.
 * The animation itself is pure CSS; this module only handles closing (the buttons marked data-intro-close, a click,
 * Esc/Enter/Space, or the auto-close timer), focus and keeping the page behind it inert.
 * It resolves when the screen is gone, and immediately if the markup is absent. The map site is shown directly after it.
 */
const AUTO_CLOSE_MS = 15000; // the animation takes about 7.5 s; the rest is reading time
const REDUCED_MOTION_MS = 8000;
const FADE_OUT_MS = 600;

export function playIntro() {
  const intro = document.getElementById('intro');
  if (!intro) return Promise.resolve();

  const closers = intro.querySelectorAll('[data-intro-close]');
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behind = [...document.body.children].filter((node) => node !== intro);
  behind.forEach((node) => node.setAttribute('inert', ''));

  return new Promise((resolve) => {
    let finished = false;
    let timer = null;

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      intro.classList.add('is-leaving');
      behind.forEach((node) => node.removeAttribute('inert'));
      setTimeout(() => {
        intro.remove();
        resolve();
      }, FADE_OUT_MS);
    }

    function onKey(event) {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        finish();
      }
    }

    closers.forEach((button) => button.addEventListener('click', finish));
    intro.addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    if (reduced) intro.classList.add('is-static');
    timer = setTimeout(finish, reduced ? REDUCED_MOTION_MS : AUTO_CLOSE_MS);
    document.getElementById('intro-skip')?.focus();
  });
}
