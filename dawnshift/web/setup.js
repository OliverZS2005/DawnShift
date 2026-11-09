// Shim for the Capacitor (Android) shell, which loads this file on boot.
// On the hosted website the service worker is registered from public/app.js.
if (globalThis.dawnshiftUnsupported) await new Promise(() => {});
