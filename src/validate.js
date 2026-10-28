'use strict';

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.status = 400;
    this.expose = true;
    this.field = field;
  }
}

// Strip ASCII control characters (keeps \n and \t) and normalise unicode.
function clean(value, { multiline = false } = {}) {
  let s = String(value).normalize('NFC');
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  // Remove bidi override characters that can be used to spoof text.
  return s.replace(/[‪-‮⁦-⁩]/g, '').trim();
}

function str(body, field, { max = 200, min = 0, required = false, multiline = false, label = field } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ValidationError(`${label} is required.`, field);
    return '';
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new ValidationError(`${label} is invalid.`, field);
  const s = clean(raw, { multiline });
  if (required && !s) throw new ValidationError(`${label} is required.`, field);
  if (s.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`, field);
  if (s.length < min) throw new ValidationError(`${label} must be at least ${min} characters.`, field);
  return s;
}

function bool(body, field, fallback = false) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return ['1', 'true', 'on', 'yes'].includes(String(v).toLowerCase());
}

function intField(body, field, { min = 0, max = 1e9, fallback = null, label = field } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return fallback;
  const s = String(v);
  if (!/^-?\d{1,10}$/.test(s)) throw new ValidationError(`${label} must be a whole number.`, field);
  const n = Number(s);
  if (n < min || n > max) throw new ValidationError(`${label} is out of range.`, field);
  return n;
}

function oneOf(body, field, allowed, fallback) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return fallback;
  if (!allowed.includes(v)) throw new ValidationError(`${field} is invalid.`, field);
  return v;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function email(body, field, { required = false, label = 'Email' } = {}) {
  const s = str(body, field, { max: 254, required, label });
  if (s && !EMAIL.test(s)) throw new ValidationError(`${label} is not a valid email address.`, field);
  return s;
}

/** Only absolute https URLs are accepted so javascript:, data: etc. can never reach an href. */
function httpsUrl(body, field, { label = field } = {}) {
  const s = str(body, field, { max: 300, label });
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { throw new ValidationError(`${label} must be a full https:// link.`, field); }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) {
    throw new ValidationError(`${label} must be a full https:// link.`, field);
  }
  return u.href;
}

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function idParam(value) {
  const s = String(value);
  if (!/^\d{1,10}$/.test(s)) throw new ValidationError('Invalid id.');
  return Number(s);
}

module.exports = { ValidationError, clean, str, bool, intField, oneOf, email, httpsUrl, slugify, idParam };
