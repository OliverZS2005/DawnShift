// Browser notifications for Dawnshift. Pings the user when a bot needs them,
// even if the tab's in the background (and on phones with the PWA installed,
// even if the browser isn't open at the time, though only while the OS keeps
// the service worker alive).
//
// Keeps the "not asked yet / allowed / blocked" state in sync with whatever
// the browser reports. On iOS and some older browsers Notification may not
// exist at all; those cases just no-op.

const KEY = 'dawnshift-notify-enabled';

export const supported = typeof Notification !== 'undefined' && typeof navigator.serviceWorker !== 'undefined';

export function state() {
  if (!supported) return 'unsupported';
  const browser = Notification.permission; // 'default' | 'granted' | 'denied'
  if (browser === 'denied') return 'blocked';
  if (browser === 'default') return 'ask';
  // Browser says yes. The user can still turn them off inside Dawnshift.
  try {
    return localStorage.getItem(KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

export async function enable() {
  if (!supported) return 'unsupported';
  if (Notification.permission === 'default') {
    const res = await Notification.requestPermission();
    if (res !== 'granted') return res === 'denied' ? 'blocked' : 'ask';
  }
  try { localStorage.setItem(KEY, 'on'); } catch {}
  return 'on';
}

export function disable() {
  try { localStorage.setItem(KEY, 'off'); } catch {}
}

// Shows a notification. Clicking it brings the Dawnshift tab back to front.
export async function notify(title, body, { tag, onClick } = {}) {
  if (state() !== 'on') return;
  // Don't ping if the user is already looking at the page.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const options = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', renotify: Boolean(tag) };
    if (reg) {
      // The service worker owns the notification: it can bring Dawnshift back
      // even if the tab was closed.
      await reg.showNotification(title, { ...options, data: { kind: 'dawnshift', tag } });
    } else {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); onClick?.(); };
    }
  } catch {
    // Permission revoked, quota full, or some other browser quirk: ignore.
  }
}
