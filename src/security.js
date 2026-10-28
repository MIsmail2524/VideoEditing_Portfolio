'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// scrypt parameters: N=2^15, r=8, p=1 (~32 MiB of memory per hash).
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAX_PASSWORD_LENGTH = 256;
const MIN_PASSWORD_LENGTH = 12;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// A precomputed hash used to keep timing identical when the username does not exist.
let dummyHash = null;
async function getDummyHash() {
  if (!dummyHash) dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummyHash;
}

function passwordProblem(password, username = '') {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, numbers, symbols.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'Password must not contain the username.';
  return null;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && !(name in out)) {
      try { out[name] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
    }
  }
  return out;
}

function createSessionStore(db, config) {
  // __Host- prefix forces Secure, Path=/ and no Domain: the cookie cannot be set by subdomains.
  const cookieName = config.cookieSecure ? '__Host-vp_sid' : 'vp_sid';

  const stmts = {
    insert: db.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen, expires_at, ip, user_agent)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    find: db.prepare(`SELECT s.token_hash, s.user_id, s.csrf_token, s.created_at, s.last_seen, s.expires_at,
                             u.username, u.password_changed_at
                      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`),
    touch: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeUserOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    removeExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen < ?'),
  };

  function cookieOptions(maxAgeMs) {
    const attrs = [`Path=/`, 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (config.cookieSecure) attrs.push('Secure');
    return attrs.join('; ');
  }

  function create(res, userId, req) {
    const token = randomToken(32);
    const now = Date.now();
    stmts.insert.run(
      sha256(token), userId, randomToken(32), now, now, now + config.sessionAbsoluteMs,
      String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 300),
    );
    res.append('Set-Cookie', `${cookieName}=${token}; ${cookieOptions(config.sessionAbsoluteMs)}`);
    return token;
  }

  function clearCookie(res) {
    res.append('Set-Cookie', `${cookieName}=; ${cookieOptions(0)}`);
  }

  function load(req) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const row = stmts.find.get(hash);
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at < now || row.last_seen + config.sessionIdleMs < now || row.created_at < row.password_changed_at) {
      stmts.remove.run(hash);
      return null;
    }
    if (now - row.last_seen > 60 * 1000) stmts.touch.run(now, hash);
    return { tokenHash: hash, userId: row.user_id, username: row.username, csrfToken: row.csrf_token };
  }

  function destroy(session) {
    if (session) stmts.remove.run(session.tokenHash);
  }

  function destroyOthers(session) {
    stmts.removeUserOthers.run(session.userId, session.tokenHash);
  }

  function purgeExpired() {
    const now = Date.now();
    stmts.removeExpired.run(now, now - config.sessionIdleMs);
  }

  return { create, load, destroy, destroyOthers, clearCookie, purgeExpired, cookieName };
}

module.exports = {
  hashPassword,
  verifyPassword,
  getDummyHash,
  passwordProblem,
  randomToken,
  sha256,
  safeEqual,
  parseCookies,
  createSessionStore,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
};
