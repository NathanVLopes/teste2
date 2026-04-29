import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(rootDir, 'data');

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const secretFile = join(dataDir, 'app-secret.key');

function loadSecret() {
  if (process.env.NAVETRAN_SECRET && process.env.NAVETRAN_SECRET.length >= 32) {
    return Buffer.from(process.env.NAVETRAN_SECRET, 'utf8');
  }

  if (!existsSync(secretFile)) {
    writeFileSync(secretFile, randomBytes(48).toString('base64'), { encoding: 'utf8' });
  }

  return Buffer.from(readFileSync(secretFile, 'utf8').trim(), 'base64');
}

export const config = {
  rootDir,
  dataDir,
  dbFile: join(dataDir, 'navetran.sqlite'),
  publicDir: join(rootDir, 'public'),
  port: Number(process.env.PORT || 3000),
  appSecret: loadSecret(),
  acaValidityYears: 5,
  residenceProofMaxAgeDays: 90,
  municipality: 'Navegantes/SC',
  platePrefix: 'NAV'
};

