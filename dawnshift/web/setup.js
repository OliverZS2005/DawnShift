// Entry point for the web bundle used by the Capacitor (Android) shell.
// In the hosted model the page talks to the server directly, so all this does
// is load the interface and register the service worker.
if (globalThis.dawnshiftUnsupported) await new Promise(() => {});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
