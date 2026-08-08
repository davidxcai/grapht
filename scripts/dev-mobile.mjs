#!/usr/bin/env node
// Dev server over HTTPS on the LAN, so a phone can reach it.
//
// The camera, and anything else behind a secure context, is unavailable over
// plain http on a LAN IP — only `localhost` gets the exemption. So this issues
// a mkcert certificate covering this machine's current LAN address and hands it
// to `next dev`. The phone has to trust the mkcert root once; port 3001 serves
// it over plain http for exactly that reason (a phone that doesn't trust the
// root yet can't fetch the root over a cert signed by it).

import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const CERT_DIR = resolve(import.meta.dirname, '..', 'certificates');
const CERT = resolve(CERT_DIR, 'localhost.pem');
const KEY = resolve(CERT_DIR, 'localhost-key.pem');
const CA_PORT = 3001;

function lanAddress() {
  const candidates = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  if (candidates.length === 0) {
    console.error('No LAN address found — is Wi-Fi on?');
    process.exit(1);
  }
  return candidates[0];
}

function mkcertPath() {
  try {
    return execFileSync('which', ['mkcert'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('mkcert is not installed. Run: brew install mkcert && mkcert -install');
    process.exit(1);
  }
}

function certCovers(host) {
  if (!existsSync(CERT) || !existsSync(KEY)) return false;
  // A LAN address lands in the certificate as an IP SAN, and `checkHost` only
  // reads DNS names — it would report every certificate as stale and reissue on
  // every start.
  return new X509Certificate(readFileSync(CERT)).checkIP(host) !== undefined;
}

const host = lanAddress();
const mkcert = mkcertPath();

if (!certCovers(host)) {
  console.log(`Issuing a certificate for ${host}...`);
  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(mkcert, ['-cert-file', CERT, '-key-file', KEY, 'localhost', '127.0.0.1', '::1', host], {
    stdio: 'inherit',
  });
}

const caRoot = resolve(execFileSync(mkcert, ['-CAROOT'], { encoding: 'utf8' }).trim(), 'rootCA.pem');
const caBody = readFileSync(caRoot);

// Plain http, and only the root certificate — nothing else is served here.
createServer((req, res) => {
  res.writeHead(200, {
    'content-type': 'application/x-x509-ca-cert',
    'content-disposition': 'attachment; filename="grapht-dev-ca.pem"',
  });
  res.end(caBody);
}).listen(CA_PORT, '0.0.0.0');

console.log(`
  Phone:      https://${host}:3000
  Trust once: http://${host}:${CA_PORT}   (install, then enable under
              Settings > General > About > Certificate Trust Settings)
`);

spawn(
  'npx',
  [
    'next',
    'dev',
    '-H',
    '0.0.0.0',
    // `--experimental-https` is the switch; without it the key and cert paths
    // are parsed and then ignored, and the server comes up on plain http.
    '--experimental-https',
    '--experimental-https-key',
    KEY,
    '--experimental-https-cert',
    CERT,
    '--experimental-https-ca',
    caRoot,
  ],
  { stdio: 'inherit', env: { ...process.env, DEV_LAN_HOST: host } },
).on('exit', (code) => process.exit(code ?? 0));
