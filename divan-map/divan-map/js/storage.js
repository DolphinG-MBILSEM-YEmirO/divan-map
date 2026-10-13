/**
 * Local-only storage. Nothing here leaves the device.
 * Every call is wrapped in try/catch because storage can be blocked
 * (private windows, school-managed browsers) and the app must still work.
 */

const PREFIX = 'dlt:';

export function readLocal(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes every key written by this app. Returns how many were removed. */
export function clearAllLocal() {
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    keys.forEach((key) => {
      window.localStorage.removeItem(key);
      removed += 1;
    });
  } catch {
    /* storage unavailable: nothing to remove */
  }
  return removed;
}
