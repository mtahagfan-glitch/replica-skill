// Pure helpers: time, geo, phone, crypto, validation. No I/O, unit-tested.
import crypto from 'node:crypto';

// Saudi Arabia is UTC+3 all year (no daylight saving).
export const SCHOOL_TZ_OFFSET_MIN = 180;

export function schoolClock(nowMs = Date.now()) {
  const d = new Date(nowMs + SCHOOL_TZ_OFFSET_MIN * 60_000);
  const iso = d.toISOString();
  return { day: iso.slice(0, 10), hm: iso.slice(11, 16), weekday: d.getUTCDay() };
}

export function inWindow(hm, start, end) {
  return start <= end ? hm >= start && hm <= end : hm >= start || hm <= end;
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// GPS accuracy helps a little, never more than 50 m, so a 2 km "accuracy" can't fake presence.
export function insideGeofence(school, lat, lng, accuracy) {
  const d = distanceMeters(school.lat, school.lng, lat, lng);
  const slack = Math.min(Math.max(Number(accuracy) || 0, 0), 50);
  return { inside: d <= school.radius_m + slack, distance: Math.round(d) };
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toLatinDigits(s) {
  return String(s ?? '').replace(/[٠-٩۰-۹]/g, (c) => String(AR_DIGITS.indexOf(c) >= 0 ? AR_DIGITS.indexOf(c) : FA_DIGITS.indexOf(c)));
}

// Accepts 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX, 009665XXXXXXXX, Arabic digits, spaces, dashes.
export function normalizeSaudiPhone(input) {
  let s = toLatinDigits(input).replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('966')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  if (!/^5\d{8}$/.test(s)) return null;
  return '966' + s;
}

export function displayPhone(e164) {
  return e164 ? '0' + e164.slice(3) : '';
}

export const id = () => crypto.randomUUID();
export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');
export const randomDigits = (n) => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 32);
  const want = Buffer.from(key, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Delegation applies today?
export function grantActive(row, clock) {
  if (row.role === 'owner') return true;
  if (!String(row.days ?? '0123456').includes(String(clock.weekday))) return false;
  if (row.valid_from && clock.day < row.valid_from) return false;
  if (row.valid_to && clock.day > row.valid_to) return false;
  return true;
}

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

// Tiny validators: v.str(body.name, 'name', {max:80})
export const v = {
  str(x, field, { min = 1, max = 200, optional = false } = {}) {
    if (x == null || x === '') { if (optional) return ''; throw new HttpError(400, 'invalid', `${field} مطلوب`); }
    if (typeof x !== 'string') throw new HttpError(400, 'invalid', `${field} غير صالح`);
    const s = x.trim();
    if (s.length < min || s.length > max) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return s;
  },
  num(x, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
    if (x == null || x === '') { if (optional) return null; throw new HttpError(400, 'invalid', `${field} مطلوب`); }
    const n = Number(x);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return n;
  },
  ids(x, field, { optional = true } = {}) {
    if (x == null) { if (optional) return null; throw new HttpError(400, 'invalid', `${field} مطلوب`); }
    if (!Array.isArray(x) || x.length > 20 || !x.every((s) => typeof s === 'string' && s.length <= 64)) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return x;
  },
  hm(x, field) {
    const s = toLatinDigits(x);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return s;
  },
  date(x, field, { optional = true } = {}) {
    if (x == null || x === '') { if (optional) return null; throw new HttpError(400, 'invalid', `${field} مطلوب`); }
    const s = toLatinDigits(x);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return s;
  },
  oneOf(x, field, list) {
    if (!list.includes(x)) throw new HttpError(400, 'invalid', `${field} غير صالح`);
    return x;
  },
};

// Minimal CSV (handles quotes, commas, CRLF, BOM). For the Noor/Excel export import.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === '؛') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
