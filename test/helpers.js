'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('../src/config');
const { createApp } = require('../src/app');
const { upsertAdmin } = require('../scripts/create-admin');

const ADMIN = { username: 'editor', password: 'Correct-Horse-9-Battery' };

async function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-test-'));
  const config = load({
    NODE_ENV: 'test',
    DATA_DIR: dir,
    COOKIE_SECURE: 'false',
    FETCH_REMOTE_THUMBNAILS: 'false',
    LOG_REQUESTS: 'false',
    MAX_VIDEO_MB: '2',
    MAX_IMAGE_MB: '1',
    SITE_URL: '',
    TRUST_PROXY: '',
    ...env,
  });
  const app = createApp(config);
  await upsertAdmin(app.locals.db, ADMIN.username, ADMIN.password);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    config,
    db: app.locals.db,
    dir,
    async close() {
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      app.locals.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Minimal HTTP client with a cookie jar and automatic CSRF header. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
    this.csrf = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req(method, url, { json, form, headers = {}, raw, csrf = true } = {}) {
    const h = { accept: 'application/json', ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();
    if (csrf && this.csrf && !('x-csrf-token' in headers)) h['x-csrf-token'] = this.csrf;
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = typeof json === 'string' ? json : JSON.stringify(json);
    } else if (form) body = form;
    else if (raw !== undefined) body = raw;
    const res = await fetch(this.base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/Max-Age=0/i.test(c) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, headers: res.headers, data, text, setCookie: res.headers.getSetCookie() };
  }

  get(url, opts) { return this.req('GET', url, opts); }
  post(url, json, opts = {}) { return this.req('POST', url, { json, ...opts }); }
  put(url, json, opts = {}) { return this.req('PUT', url, { json, ...opts }); }
  patch(url, json, opts = {}) { return this.req('PATCH', url, { json, ...opts }); }
  del(url, opts) { return this.req('DELETE', url, opts); }

  async login(username = ADMIN.username, password = ADMIN.password) {
    const res = await this.post('/api/admin/login', { username, password });
    if (res.status === 200) {
      const me = await this.get('/api/admin/me');
      this.csrf = me.data.csrfToken;
    }
    return res;
  }
}

// Smallest byte sequences that pass the server's file-type sniffing.
const FAKE = {
  mp4: () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]),
  webm: () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 2)]),
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]),
  jpg: () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 4)]),
};

function videoForm(fields, files = {}) {
  const fd = new FormData();
  // Every video belongs to a category; default to the first seeded one unless the test chooses.
  if (!('categoryId' in fields)) fields = { categoryId: 1, ...fields };
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  for (const [k, [buf, name, type]] of Object.entries(files)) fd.append(k, new Blob([buf], { type: type || 'application/octet-stream' }), name);
  return fd;
}

module.exports = { startServer, Client, ADMIN, FAKE, videoForm };
