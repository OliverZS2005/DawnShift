// Starts Dawnshift's engine inside the page for the web version. This runs
// before the interface (public/app.js) loads, which finds the engine through
// globalThis.dawnshiftLocal.
import { createBrowserStore } from '../src/browser-store.js';
import { createRunner } from '../src/runner.js';
import { createApi } from '../src/api.js';
import { callModel } from '../src/providers.js';
import { createSync } from './sync.js';

// index.html already explained that this browser is too old.
if (globalThis.dawnshiftUnsupported) await new Promise(() => {});

// Only one tab may run the bots at a time, or two tabs would overwrite each
// other's work. A second tab just says so.
const isOnlyTab = await new Promise((resolve) => {
  if (!navigator.locks) return resolve(true);
  navigator.locks.request('dawnshift-engine', { ifAvailable: true }, (lock) => {
    resolve(Boolean(lock));
    // Holding the lock for as long as this tab is open.
    return lock ? new Promise(() => {}) : undefined;
  });
});

if (!isOnlyTab) {
  const main = document.getElementById('main');
  main.innerHTML = `<div class="page"><h1>Dawnshift is already open</h1>
    <p class="lede">It's running in another tab or window. Use that one, or close it and reload this page.</p>
    <button class="primary" onclick="location.reload()">Reload</button></div>`;
  await new Promise(() => {}); // Stop here: don't start a second engine.
}

const store = await createBrowserStore();
const runner = createRunner({ store, callModel });
runner.start();
globalThis.dawnshiftLocal = createApi(store, runner);

// Accounts: only switched on if the website also runs the sync server.
const sync = createSync({ store, runner });
globalThis.dawnshiftSync = sync;
sync.start();

// Lets the app open offline and be installed to the home screen.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
