'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trustProxy(value) {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (['true', 'false'].includes(value)) return value === 'true';
  return value; // e.g. "loopback" or a comma separated list of subnets
}

function load(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const isProduction = env.NODE_ENV === 'production';
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');

  return Object.freeze({
    root: ROOT,
    isProduction,
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    siteUrl: (env.SITE_URL || '').replace(/\/+$/, ''),
    dataDir,
    dbFile: env.DB_FILE ? path.resolve(ROOT, env.DB_FILE) : path.join(dataDir, 'portfolio.db'),
    uploadDir: path.resolve(ROOT, env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
    publicDir: path.join(ROOT, 'public'),
    // Cookies are marked Secure by default in production. Only disable when testing over plain HTTP.
    cookieSecure: bool(env.COOKIE_SECURE, isProduction),
    trustProxy: trustProxy(env.TRUST_PROXY),
    maxVideoBytes: int(env.MAX_VIDEO_MB, 500) * 1024 * 1024,
    maxImageBytes: int(env.MAX_IMAGE_MB, 8) * 1024 * 1024,
    sessionIdleMs: int(env.SESSION_IDLE_MINUTES, 120) * 60 * 1000,
    sessionAbsoluteMs: int(env.SESSION_MAX_HOURS, 12) * 60 * 60 * 1000,
    loginMaxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 5),
    loginLockMs: int(env.LOGIN_LOCK_MINUTES, 15) * 60 * 1000,
    fetchRemoteThumbnails: bool(env.FETCH_REMOTE_THUMBNAILS, true),
    logRequests: bool(env.LOG_REQUESTS, isProduction),
  });
}

module.exports = { load };
