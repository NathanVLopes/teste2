import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { config } from './config.js';

const encryptionKey = createHash('sha256').update(config.appSecret).digest();

export function normalizeDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

export function normalizeLookup(value = '') {
  return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
}

export function hashLookup(value = '') {
  return createHash('sha256')
    .update(String(value))
    .update(config.appSecret)
    .digest('hex');
}

export function encryptText(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptText(value) {
  if (!value) {
    return '';
  }

  const [version, ivText, tagText, dataText] = String(value).split(':');
  if (version !== 'v1') {
    return '';
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function makePassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = pbkdf2Sync(password, salt, 180000, 32, 'sha256').toString('base64url');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) {
    return false;
  }

  const derived = pbkdf2Sync(password, salt, 180000, 32, 'sha256');
  const storedBuffer = Buffer.from(hash, 'base64url');
  return storedBuffer.length === derived.length && timingSafeEqual(storedBuffer, derived);
}

export function secureToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function tokenHash(token) {
  return hashLookup(`token:${token}`);
}

export function sessionHash(token) {
  return hashLookup(`session:${token}`);
}

export function addYears(dateText, years) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setFullYear(date.getFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function isMinor(birthDate, referenceDate = todayISO()) {
  if (!birthDate) {
    return false;
  }

  const birth = new Date(`${birthDate}T12:00:00`);
  const reference = new Date(`${referenceDate}T12:00:00`);
  let age = reference.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    reference.getMonth() < birth.getMonth() ||
    (reference.getMonth() === birth.getMonth() && reference.getDate() < birth.getDate());
  if (beforeBirthday) {
    age -= 1;
  }

  return age < 18;
}

export function daysBetween(dateText, referenceDate = todayISO()) {
  if (!dateText) {
    return Infinity;
  }

  const start = new Date(`${dateText}T00:00:00`);
  const end = new Date(`${referenceDate}T00:00:00`);
  return Math.floor((end - start) / 86400000);
}

export function formatCpfCnpj(value = '') {
  const digits = normalizeDigits(value);
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value;
}
