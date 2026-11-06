/**
 * Registers the service worker (sw.js) so the site can be installed and opened without a connection after one
 * visit. Nothing about the visitor is stored or sent; the worker only keeps copies of the site's own files.
 * Skipped where service workers are not available (old browsers, file://, tests).
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* the site works the same without it */ });
  });
}

registerServiceWorker();
