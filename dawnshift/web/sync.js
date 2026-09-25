// Accounts and syncing for the web version. Everything is encrypted on this
// device before it's uploaded (see src/sync-crypto.js), so the server that
// stores it can't read anyone's keys, tasks or files.
import {
  deriveKeys, newDataKey, wrapKey, unwrapRaw, importDataKey, encryptJson, decryptJson,
  newRecoveryCode, normalizeRecoveryCode, randomBytes, toB64,
} from '../src/sync-crypto.js';
import { mergeData, sameData } from '../src/sync-merge.js';

const PUSH_DELAY_MS = 2500;
const PULL_EVERY_MS = 30000;

export function createSync({ store, runner }) {
  let session = null; // { username, token, key, version }
  let dirty = true; // true until this device's data is known to be uploaded
  let busy = false;
  let again = false;
  let pushTimer = null;
  const status = { available: false, loggedIn: false, username: '', state: 'idle', message: '', lastSynced: null };
  const listeners = new Set();

  function setStatus(patch) {
    Object.assign(status, patch, { loggedIn: Boolean(session), username: session?.username ?? '' });
    for (const fn of listeners) fn({ ...status });
  }

  async function request(method, url, body, { token = session?.token } = {}) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error("Can't reach the Dawnshift server. Check your internet connection."), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.error === 'conflict') return { conflict: true, ...data };
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  async function startSession({ username, token, rawKey, version = 0 }) {
    session = { username, token, key: await importDataKey(rawKey), version };
    await store.session.set(session);
    dirty = true;
    setStatus({ state: 'syncing', message: '' });
    await syncNow();
  }

  // ---------- syncing ----------

  async function syncNow() {
    if (!session) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    clearTimeout(pushTimer);
    setStatus({ state: 'syncing' });
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await request('GET', '/api/sync');
        let upload = dirty || !remote.blob;
        if (remote.blob && remote.version !== session.version) {
          const theirs = await decryptJson(session.key, remote.blob);
          const merged = mergeData(await store.exportData(), theirs, { preferLocal: runner.isRunning });
          const newerHere = await store.applyData(merged, { keepLocal: runner.isRunning });
          upload = newerHere || !sameData(merged, theirs);
        }
        session.version = remote.version;
        if (!upload) break;

        dirty = false;
        const blob = await encryptJson(session.key, await store.exportData());
        const res = await request('PUT', '/api/sync', { baseVersion: session.version, blob });
        if (res.conflict) {
          // Another device saved first: merge with theirs and try again.
          dirty = true;
          continue;
        }
        session.version = res.version;
        break;
      }
      await store.session.set(session);
      setStatus({ state: 'synced', message: '', lastSynced: new Date().toISOString() });
    } catch (err) {
      if (err.status === 401) {
        await forgetSession();
        setStatus({ state: 'idle', message: 'You were logged out. Please log in again.' });
      } else {
        dirty = true;
        setStatus({ state: err.offline ? 'offline' : 'error', message: err.message });
      }
    } finally {
      busy = false;
      if (again) {
        again = false;
        syncNow();
      }
    }
  }

  function schedule() {
    if (!session) return;
    dirty = true;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
  }

  async function forgetSession() {
    session = null;
    await store.session.clear();
  }

  // ---------- account actions ----------

  // Signs in with the password and returns the data key's raw bytes.
  async function unlock(username, password) {
    const { salt } = await request('GET', `/api/account/prelogin?username=${encodeURIComponent(username)}`);
    const { auth, key } = await deriveKeys(password, salt);
    const res = await request('POST', '/api/account/login', { username, auth });
    return { res, auth, rawKey: await unwrapRaw(key, res.wrappedKey) };
  }

  async function passwordFields(password, rawKey) {
    const salt = toB64(randomBytes(16));
    const { auth, key } = await deriveKeys(password, salt);
    return { salt, auth, wrappedKey: await wrapKey(key, rawKey) };
  }

  function checkPassword(password) {
    if (String(password).length < 8) throw new Error('Use a password of at least 8 characters. A few random words works well.');
  }

  const api = {
    onStatus(fn) {
      listeners.add(fn);
      fn({ ...status });
      return () => listeners.delete(fn);
    },
    syncNow,

    // Returns the recovery code, which the user must write down.
    async signup(username, password) {
      checkPassword(password);
      const recoveryCode = newRecoveryCode();
      const { raw } = await newDataKey();
      const pw = await passwordFields(password, raw);
      const recoverySalt = toB64(randomBytes(16));
      const rec = await deriveKeys(normalizeRecoveryCode(recoveryCode), recoverySalt);
      const res = await request('POST', '/api/account/register', {
        username,
        ...pw,
        recoverySalt,
        recoveryAuth: rec.auth,
        recoveryWrappedKey: await wrapKey(rec.key, raw),
      });
      await startSession({ username: res.username, token: res.token, rawKey: raw });
      return recoveryCode;
    },

    async login(username, password) {
      const { res, rawKey } = await unlock(username, password);
      await startSession({ username: res.username, token: res.token, rawKey });
    },

    // Forgot the password: log in with the recovery code and choose a new one.
    async recover(username, recoveryCode, newPassword) {
      checkPassword(newPassword);
      const { recoverySalt } = await request('GET', `/api/account/prelogin?username=${encodeURIComponent(username)}`);
      const rec = await deriveKeys(normalizeRecoveryCode(recoveryCode), recoverySalt);
      const res = await request('POST', '/api/account/login-recovery', { username, recoveryAuth: rec.auth });
      const rawKey = await unwrapRaw(rec.key, res.recoveryWrappedKey);
      await request('POST', '/api/account/password', await passwordFields(newPassword, rawKey), { token: res.token });
      await startSession({ username: res.username, token: res.token, rawKey });
    },

    async changePassword(currentPassword, newPassword) {
      checkPassword(newPassword);
      const { res, auth, rawKey } = await unlock(session.username, currentPassword);
      await request('POST', '/api/account/password', { currentAuth: auth, ...(await passwordFields(newPassword, rawKey)) }, { token: res.token });
      await request('POST', '/api/account/logout').catch(() => {});
      session.token = res.token;
      await store.session.set(session);
      setStatus({});
    },

    // keepData: leave this device's copy in place (otherwise it's removed).
    async logout({ keepData = false } = {}) {
      if (session) await request('POST', '/api/account/logout').catch(() => {});
      await forgetSession();
      if (!keepData) await store.clearAll();
      setStatus({ state: 'idle', message: '' });
    },

    async deleteAccount(password) {
      const { auth } = await unlock(session.username, password);
      await request('POST', '/api/account/delete', { auth });
      await forgetSession();
      setStatus({ state: 'idle', message: 'Your account and its synced data were deleted. This device still has its own copy.' });
    },

    // Asks the website whether it runs the account server.
    async checkAvailable() {
      try {
        status.available = (await request('GET', '/api/health', undefined, { token: null })).service === 'dawnshift-sync';
      } catch {
        status.available = false;
      }
      setStatus({ checked: true });
      if (status.available && session) syncNow();
      return status.available;
    },

    async start() {
      store.onChange(schedule);
      session = (await store.session.get()) ?? null;
      await api.checkAvailable();
      setInterval(() => session && status.available && syncNow(), PULL_EVERY_MS);
      addEventListener('online', () => session && status.available && syncNow());
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && session && status.available && syncNow());
    },
  };
  return api;
}
