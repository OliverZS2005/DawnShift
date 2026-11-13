// Bots' web requests (fetch) only trust Node's own built-in certificate list
// by default. On many machines that isn't enough: a home router, firewall,
// antivirus or company network adds its own certificate, which the operating
// system trusts but Node doesn't, and every request fails with
// UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Trust the system's certificates too.
import tls from 'node:tls';
import fs from 'node:fs';

const BUNDLES = [
  '/etc/ssl/certs/ca-certificates.crt', // Debian, Ubuntu
  '/etc/pki/tls/certs/ca-bundle.crt', // Fedora, RHEL
  '/etc/ssl/cert.pem', // Alpine, macOS
];

function splitPem(text) {
  return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

export function useSystemCertificates() {
  if (typeof tls.setDefaultCACertificates !== 'function' || typeof tls.getCACertificates !== 'function') return false;
  try {
    const certs = new Set(tls.getCACertificates('default'));
    try {
      for (const c of tls.getCACertificates('system')) certs.add(c);
    } catch {}
    for (const file of BUNDLES) {
      try {
        for (const c of splitPem(fs.readFileSync(file, 'utf8'))) certs.add(c);
      } catch {}
    }
    tls.setDefaultCACertificates([...certs]);
    return true;
  } catch {
    return false;
  }
}
