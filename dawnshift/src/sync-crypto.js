// End-to-end encryption for Dawnshift accounts. Everything here runs on the
// user's device (it also works in Node, for tests). The sync server only ever
// sees a login proof derived from the password, and encrypted data.
//
// How it fits together:
//   password + salt  --PBKDF2-->  auth (sent to the server, which hashes it again)
//                                 + password key (never leaves the device)
//   data key: random; encrypts everything. Stored on the server twice,
//   wrapped by the password key and by the recovery code's key.
const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// OWASP's recommendation for PBKDF2-SHA256. Takes about a second on a phone.
export const ITERATIONS = 600_000;

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Turns a password (or recovery code) into a login proof and an encryption key.
export async function deriveKeys(secret, saltB64, iterations = ITERATIONS) {
  const base = await subtle.importKey('raw', encoder.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations }, base, 512),
  );
  const key = await subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { auth: toB64(bits.slice(0, 32)), key };
}

async function seal(key, bytes) {
  const iv = randomBytes(12);
  const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + sealed.length);
  out.set(iv);
  out.set(sealed, 12);
  return toB64(out);
}

async function open(key, b64) {
  const data = fromB64(b64);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12)));
}

// A fresh random data key: the raw bytes (to wrap) and a usable key.
export async function newDataKey() {
  const raw = randomBytes(32);
  return { raw, key: await importDataKey(raw) };
}

export const importDataKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export const wrapKey = (wrappingKey, raw) => seal(wrappingKey, raw);

// Returns the data key's raw bytes (needed to re-wrap it for a new password).
export async function unwrapRaw(wrappingKey, wrapped) {
  try {
    return await open(wrappingKey, wrapped);
  } catch {
    throw new Error("Couldn't unlock your data. The password or recovery code doesn't match.");
  }
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Compresses and encrypts any JSON-able value.
export async function encryptJson(key, value) {
  const packed = await pipe(encoder.encode(JSON.stringify(value)), new CompressionStream('gzip'));
  return seal(key, packed);
}

export async function decryptJson(key, b64) {
  const packed = await open(key, b64);
  return JSON.parse(decoder.decode(await pipe(packed, new DecompressionStream('gzip'))));
}

// Recovery codes look like ABCD-EFGH-JKLM-NPQR-STUV-WXYZ (no 0/O/1/I mix-ups).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCode() {
  const chars = Array.from(randomBytes(24), (b) => ALPHABET[b % 32]).join('');
  return chars.match(/.{4}/g).join('-');
}

export function normalizeRecoveryCode(code) {
  return String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
