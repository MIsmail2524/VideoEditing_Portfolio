'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, Client, ADMIN, FAKE, videoForm } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(() => srv.close());

const ADMIN_ROUTES = [
  ['GET', '/api/admin/me'], ['GET', '/api/admin/videos'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/settings'],
  ['GET', '/api/admin/messages'], ['GET', '/api/admin/categories'], ['POST', '/api/admin/videos'], ['PUT', '/api/admin/videos/1'],
  ['PATCH', '/api/admin/videos/1'], ['DELETE', '/api/admin/videos/1'], ['POST', '/api/admin/videos/reorder'],
  ['POST', '/api/admin/categories'], ['PUT', '/api/admin/categories/1'], ['DELETE', '/api/admin/categories/1'],
  ['PUT', '/api/admin/settings'], ['POST', '/api/admin/settings/avatar'], ['DELETE', '/api/admin/settings/avatar'],
  ['PATCH', '/api/admin/messages/1'], ['DELETE', '/api/admin/messages/1'], ['POST', '/api/admin/password'],
  ['POST', '/api/admin/parse-url'], ['POST', '/api/admin/logout-others'],
];

test('[authz] every admin endpoint rejects anonymous requests', async () => {
  const anon = new Client(srv.base);
  for (const [method, url] of ADMIN_ROUTES) {
    const res = await anon.req(method, url, method === 'GET' ? {} : { json: {} });
    assert.equal(res.status, 401, `${method} ${url} -> ${res.status}`);
  }
});

test('[authz] forged / random session cookies are rejected', async () => {
  const c = new Client(srv.base);
  for (const v of ['admin', 'x'.repeat(43), "' OR '1'='1", '../../etc/passwd', 'a'.repeat(5000)]) {
    c.cookies.set('vp_sid', encodeURIComponent(v));
    assert.equal((await c.get('/api/admin/me')).status, 401);
  }
});

test('[csrf] state-changing requests need the per-session token', async () => {
  const c = new Client(srv.base);
  await c.login();
  const token = c.csrf;
  c.csrf = null;
  assert.equal((await c.post('/api/admin/categories', { name: 'NoToken' })).status, 403);
  assert.equal((await c.post('/api/admin/categories', { name: 'Wrong' }, { headers: { 'x-csrf-token': 'x'.repeat(43) } })).status, 403);
  assert.equal((await c.req('POST', '/api/admin/videos', { form: videoForm({ title: 'x', url: 'https://youtu.be/aqz-KE-bpKQ' }) })).status, 403);
  // Another session's token does not work either.
  const other = new Client(srv.base);
  await other.login();
  assert.equal((await c.post('/api/admin/categories', { name: 'Cross' }, { headers: { 'x-csrf-token': other.csrf } })).status, 403);
  c.csrf = token;
  assert.equal((await c.post('/api/admin/categories', { name: 'With token' })).status, 201);
});

test('[csrf] cross-origin requests are blocked before reaching handlers', async () => {
  const c = new Client(srv.base);
  await c.login();
  const evil = await c.post('/api/admin/categories', { name: 'Evil' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const site = await c.post('/api/admin/categories', { name: 'Evil2' }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(site.status, 403);
  const contact = await new Client(srv.base).post('/api/contact', { name: 'a', email: 'a@b.co', message: 'hello there!' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(contact.status, 403);
  // Even login cannot be triggered cross-site (login CSRF).
  const login = await new Client(srv.base).post('/api/admin/login', ADMIN, { headers: { origin: 'https://evil.example' } });
  assert.equal(login.status, 403);
});

test('[session] cookie flags, fixation, logout and replay', async () => {
  const c = new Client(srv.base);
  c.cookies.set('vp_sid', 'attacker-chosen-value');
  const res = await c.post('/api/admin/login', ADMIN);
  assert.equal(res.status, 200);
  const cookie = res.setCookie.find((s) => s.startsWith('vp_sid='));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.notEqual(c.cookies.get('vp_sid'), 'attacker-chosen-value', 'server issues a fresh id');

  const stolen = c.cookies.get('vp_sid');
  c.csrf = (await c.get('/api/admin/me')).data.csrfToken;
  assert.equal((await c.post('/api/admin/logout')).status, 200);
  const replay = new Client(srv.base);
  replay.cookies.set('vp_sid', stolen);
  assert.equal((await replay.get('/api/admin/me')).status, 401, 'token is invalid server-side after logout');

  // The raw token is never stored: only its hash.
  const rows = srv.db.prepare('SELECT token_hash FROM sessions').all();
  assert.ok(rows.every((r) => /^[a-f0-9]{64}$/.test(r.token_hash) && r.token_hash !== stolen));
});

test('[session] secure deployments use a __Host- prefixed Secure cookie', async () => {
  const s2 = await startServer({ COOKIE_SECURE: 'true' });
  try {
    const res = await new Client(s2.base).post('/api/admin/login', ADMIN);
    const cookie = res.setCookie[0];
    assert.match(cookie, /^__Host-vp_sid=/);
    assert.match(cookie, /; Secure/);
  } finally { await s2.close(); }
});

test('[sqli] injection payloads in login, ids and bodies are inert', async () => {
  const anon = new Client(srv.base);
  for (const username of ["' OR '1'='1", "editor'--", "editor' OR 1=1; --", 'editor"; DROP TABLE users; --']) {
    const r = await anon.post('/api/admin/login', { username, password: "' OR '1'='1" });
    assert.equal(r.status, 401);
  }
  const c = new Client(srv.base);
  await c.login();
  for (const id of ['1%20OR%201=1', "1'", '1;DROP%20TABLE%20videos', '-1', '0x1', '1e3', '99999999999']) {
    const r = await c.del(`/api/admin/videos/${id}`);
    assert.ok([400, 404].includes(r.status), `${id} -> ${r.status}`);
  }
  const r = await c.post('/api/admin/categories', { name: "x'); DROP TABLE categories; --" });
  assert.equal(r.status, 201);
  assert.equal(r.data.category.name, "x'); DROP TABLE categories; --");
  assert.ok(srv.db.prepare('SELECT COUNT(*) AS n FROM users').get().n >= 1, 'tables intact');
});

test('[xss] stored payloads are escaped in HTML and JSON output', async () => {
  const c = new Client(srv.base);
  await c.login();
  const payload = '</script><script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  await c.put('/api/admin/settings', { site_name: payload, seo_description: payload, hero_heading: payload });
  await c.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: payload, description: payload }) });

  const html = await fetch(srv.base + '/').then((r) => r.text());
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script injection');
  assert.ok(!html.includes('<img src=x'), 'no raw tag injection');
  // Exactly the expected script tags exist.
  assert.equal((html.match(/<script/g) || []).length, 2);
  assert.match(html, /<title>&lt;\/script&gt;&lt;script&gt;alert\(1\)/);
  const json = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).settings.site_name, payload, 'data round-trips intact');

  // javascript: and other schemes can never reach an href.
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'http://insecure.example', '//evil.example', 'https://user:pw@evil.example']) {
    assert.equal((await c.put('/api/admin/settings', { social_youtube: url })).status, 400, url);
  }
  await c.put('/api/admin/settings', { site_name: 'Your Name', seo_description: 'ok', hero_heading: 'ok' });
});

test('[injection] template placeholders and $-patterns in content are not expanded', async () => {
  const c = new Client(srv.base);
  await c.login();
  await c.put('/api/admin/settings', { site_name: "{{INITIAL_DATA}} $& $' $`", seo_description: '{{TITLE}}' });
  const html = await fetch(srv.base + '/').then((r) => r.text());
  assert.match(html, /<title>\{\{INITIAL_DATA\}\} \$&amp; \$&#39; \$` — Video Editor<\/title>/);
  assert.match(html, /<meta name="description" content="\{\{TITLE\}\}">/);
  const json = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/)[1];
  assert.ok(JSON.parse(json).settings);
  await c.put('/api/admin/settings', { site_name: 'Your Name', seo_description: 'ok' });
});

test('[upload] disguised and dangerous files are rejected and cleaned up', async () => {
  const c = new Client(srv.base);
  await c.login();
  const cases = [
    ['video', Buffer.from('<html><script>alert(1)</script></html>'), 'evil.mp4', 'video/mp4'],
    ['video', Buffer.from('#!/bin/sh\nrm -rf /'), 'run.sh.mp4', 'video/mp4'],
    ['video', FAKE.png(), 'image-as-video.mp4', 'video/mp4'],
    ['video', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(32)]), 'photo.mp4', 'video/mp4'],
  ];
  for (const [field, buf, name, type] of cases) {
    const r = await c.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'upload', title: 't' }, { [field]: [buf, name, type] }) });
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.data)}`);
  }
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const r1 = await c.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 't' }, { thumbnail: [svg, 'x.svg', 'image/svg+xml'] }),
  });
  assert.equal(r1.status, 400, 'SVG thumbnails rejected');
  // A GIF/HTML polyglot is stored as .gif and served as image/gif with nosniff + sandbox CSP, so it can never run as HTML.
  const r2 = await c.req('POST', '/api/admin/settings/avatar', { form: videoForm({}, { avatar: [Buffer.from('GIF89a<script>alert(1)</script>'), 'a.html', 'text/html'] }) });
  assert.equal(r2.status, 200);
  assert.match(r2.data.settings.avatar, /\.gif$/);
  const served = await fetch(srv.base + r2.data.settings.avatar);
  assert.equal(served.headers.get('content-type'), 'image/gif');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.match(served.headers.get('content-security-policy'), /default-src 'none'; sandbox/);
  await c.del('/api/admin/settings/avatar');
  const r3 = await c.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'upload', title: 't' }, { evil: [FAKE.mp4(), 'a.mp4', 'video/mp4'] }) });
  assert.equal(r3.status, 400, 'unexpected file field');

  // Path traversal in the client file name has no effect on where files are written.
  const r4 = await c.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'upload', title: 'trav' }, { video: [FAKE.mp4(), '../../../../tmp/pwned.mp4', 'video/mp4'] }),
  });
  assert.equal(r4.status, 201);
  assert.match(r4.data.video.videoUrl, /^\/media\/videos\/[a-f0-9]{32}\.mp4$/);
  assert.ok(!fs.existsSync('/tmp/pwned.mp4'));

  // Oversized upload (limit is 2 MB in tests).
  const big = Buffer.concat([FAKE.mp4(), Buffer.alloc(3 * 1024 * 1024)]);
  const r5 = await c.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'upload', title: 'big' }, { video: [big, 'big.mp4', 'video/mp4'] }) });
  assert.equal(r5.status, 413);
  // Oversized image (limit 1 MB in tests).
  const bigImg = Buffer.concat([FAKE.png(), Buffer.alloc(1.5 * 1024 * 1024)]);
  const r6 = await c.req('POST', '/api/admin/settings/avatar', { form: videoForm({}, { avatar: [bigImg, 'a.png', 'image/png'] }) });
  assert.equal(r6.status, 400);

  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(fs.readdirSync(path.join(srv.config.uploadDir, 'tmp')), [], 'no temp files left behind');
  assert.deepEqual(fs.readdirSync(path.join(srv.config.uploadDir, 'images')), [], 'rejected images not stored');
});

test('[upload] anonymous uploads are refused before any bytes hit the disk', async () => {
  const anon = new Client(srv.base);
  const before = fs.readdirSync(path.join(srv.config.uploadDir, 'tmp')).length;
  const r = await anon.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'upload', title: 'x' }, { video: [FAKE.mp4(), 'a.mp4', 'video/mp4'] }) });
  assert.equal(r.status, 401);
  assert.equal(fs.readdirSync(path.join(srv.config.uploadDir, 'tmp')).length, before);
});

test('[traversal] media and static routes cannot escape their folders', async () => {
  fs.writeFileSync(path.join(srv.config.uploadDir, 'tmp', 'secret.upload'), 'secret');
  const probes = [
    '/media/videos/..%2f..%2fportfolio.db', '/media/videos/../portfolio.db', '/media/images/%2e%2e/%2e%2e/portfolio.db',
    '/media/tmp/secret.upload', '/media/videos/....//....//portfolio.db', '/media/images/..%5c..%5cportfolio.db',
    '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/css/..%2f..%2fserver.js', '/media/', '/media/videos/',
    '/.env', '/.git/config', '/admin/../../server.js',
  ];
  for (const p of probes) {
    const res = await fetch(srv.base + p);
    const body = await res.text();
    assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.ok(!body.includes('SQLite format') && !body.includes('secret') && !body.includes('root:'), p);
  }
});

test('[bruteforce] account locks after repeated failures with a uniform error', async () => {
  const s2 = await startServer({ LOGIN_MAX_ATTEMPTS: '3' });
  try {
    const c = new Client(s2.base);
    const wrong = await c.post('/api/admin/login', { username: ADMIN.username, password: 'nope-nope-nope' });
    const unknown = await c.post('/api/admin/login', { username: 'ghost', password: 'nope-nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error, 'no username enumeration');
    await c.post('/api/admin/login', { username: ADMIN.username, password: 'nope-nope-nope' });
    await c.post('/api/admin/login', { username: ADMIN.username, password: 'nope-nope-nope' });
    const locked = await c.post('/api/admin/login', ADMIN);
    assert.equal(locked.status, 401, 'correct password refused while locked');
    assert.equal(locked.data.error, wrong.data.error);
    // Lock expires.
    s2.db.prepare('UPDATE users SET locked_until = 0').run();
    assert.equal((await c.post('/api/admin/login', ADMIN)).status, 200);
  } finally { await s2.close(); }
});

test('[bruteforce] per-IP rate limit on login', async () => {
  const s2 = await startServer({ LOGIN_MAX_ATTEMPTS: '1000' });
  try {
    const c = new Client(s2.base);
    let last;
    for (let i = 0; i < 11; i++) last = await c.post('/api/admin/login', { username: `u${i}`, password: 'wrong-password' });
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('ratelimit') || last.headers.get('ratelimit-policy'));
  } finally { await s2.close(); }
});

test('[dos] oversized, malformed and hostile JSON bodies', async () => {
  const c = new Client(srv.base);
  const big = await c.req('POST', '/api/contact', { json: JSON.stringify({ message: 'x'.repeat(200 * 1024) }) });
  assert.equal(big.status, 413);
  const bad = await c.req('POST', '/api/contact', { raw: '{"name": ', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.ok(!bad.text.includes('at ') && !bad.text.includes('node_modules'), 'no stack trace');
  const types = await c.post('/api/contact', { name: { $gt: '' }, email: ['a@b.co'], message: 12345678901 });
  assert.equal(types.status, 400);
  const long = await c.post('/api/contact', { name: 'a'.repeat(101), email: 'a@b.co', message: 'hello there' });
  assert.equal(long.status, 400);
});

test('[mass-assignment] unknown or internal fields are ignored', async () => {
  const c = new Client(srv.base);
  await c.login();
  await c.put('/api/admin/settings', { avatar_file: '../../../etc/passwd', is_admin: '1', __proto__: { polluted: 1 } });
  const s = (await c.get('/api/admin/settings')).data.settings;
  assert.equal(s.avatar, null);
  assert.ok(!('is_admin' in s));
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'is_admin' OR (key = 'avatar_file' AND value != '')").get().n, 0);
  assert.equal({}.polluted, undefined, 'no prototype pollution');

  const r = await c.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'mass', id: '1', platform: 'upload', file_name: '../../server.js', thumbnail_file: '../x' }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.video.platform, 'youtube');
  assert.equal(r.data.video.videoUrl, null);
});

test('[contact] spam rate limit', async () => {
  const s2 = await startServer();
  try {
    const c = new Client(s2.base);
    const send = () => c.post('/api/contact', { name: 'Spam', email: 's@s.co', message: 'Hello hello hello' });
    for (let i = 0; i < 5; i++) assert.equal((await send()).status, 201);
    assert.equal((await send()).status, 429);
  } finally { await s2.close(); }
});

test('[password] change requires current password, enforces policy, revokes other sessions', async () => {
  const s2 = await startServer();
  try {
    const a = new Client(s2.base);
    const b = new Client(s2.base);
    await a.login();
    await b.login();
    assert.equal((await a.post('/api/admin/password', { currentPassword: 'wrong', newPassword: 'New-Passw0rd!123' })).status, 400);
    assert.equal((await a.post('/api/admin/password', { currentPassword: ADMIN.password, newPassword: 'short' })).status, 400);
    assert.equal((await a.post('/api/admin/password', { currentPassword: ADMIN.password, newPassword: 'alllowercaseletters' })).status, 400);
    assert.equal((await a.post('/api/admin/password', { currentPassword: ADMIN.password, newPassword: 'Editor-is-my-name-1' })).status, 400, 'contains username');
    const ok = await a.post('/api/admin/password', { currentPassword: ADMIN.password, newPassword: 'New-Passw0rd!123' });
    assert.equal(ok.status, 200);
    assert.equal((await a.get('/api/admin/me')).status, 200, 'current device stays signed in');
    assert.equal((await b.get('/api/admin/me')).status, 401, 'other devices signed out');
    assert.equal((await new Client(s2.base).login(ADMIN.username, ADMIN.password)).status, 401);
    assert.equal((await new Client(s2.base).login(ADMIN.username, 'New-Passw0rd!123')).status, 200);
    // Stored hash is scrypt, never the plain password.
    const hash = s2.db.prepare('SELECT password_hash FROM users').get().password_hash;
    assert.match(hash, /^scrypt\$32768\$8\$1\$/);
    assert.ok(!hash.includes('New-Passw0rd'));
  } finally { await s2.close(); }
});

test('[session] idle sessions expire', async () => {
  const c = new Client(srv.base);
  await c.login();
  srv.db.prepare('UPDATE sessions SET last_seen = 0').run();
  assert.equal((await c.get('/api/admin/me')).status, 401);
});

test('[headers] security headers on pages and API', async () => {
  const res = await fetch(srv.base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('permissions-policy'));
  const api = await fetch(srv.base + '/api/admin/me');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('[host-header] SITE_URL pins canonical links and the CSRF origin', async () => {
  const s2 = await startServer({ SITE_URL: 'https://portfolio.example' });
  try {
    const html = await fetch(s2.base + '/', { headers: { host: 'evil.example' } }).then((r) => r.text());
    assert.match(html, /<link rel="canonical" href="https:\/\/portfolio.example\/">/);
    assert.ok(!html.includes('evil.example'));
    const c = new Client(s2.base);
    const r = await c.post('/api/admin/login', ADMIN, { headers: { origin: s2.base } });
    assert.equal(r.status, 403, 'origin must match SITE_URL');
    assert.equal((await c.post('/api/admin/login', ADMIN, { headers: { origin: 'https://portfolio.example' } })).status, 200);
  } finally { await s2.close(); }
});

test('[tamper] corrupted DB values never produce unsafe URLs', async () => {
  const now = Date.now();
  srv.db.prepare(`INSERT INTO videos (title, platform, source_id, source_url, file_name, thumbnail_file, created_at, updated_at)
    VALUES ('t', 'youtube', '"><script>alert(1)</script>', 'javascript:alert(1)', '../../server.js', '../../.env', ?, ?)`).run(now, now);
  const pub = await fetch(`${srv.base}/api/portfolio`).then((r) => r.json());
  const v = pub.videos.find((x) => x.title === 't');
  assert.equal(v.embedUrl, null);
  assert.equal(v.sourceUrl, null);
  assert.equal(v.thumbnail, null);
  assert.equal(v.videoUrl, null);
});

test('[xss] category names are escaped on category pages', async () => {
  const c = new Client(srv.base);
  await c.login();
  const name = '</title><script>alert(1)</script>';
  const cat = (await c.post('/api/admin/categories', { name, description: '<img src=x onerror=alert(1)>' })).data.category;
  await c.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'v', categoryId: cat.id }) });
  const html = await fetch(`${srv.base}/category/${cat.slug}`).then((r) => r.text());
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.equal((html.match(/<script/g) || []).length, 2);
  assert.match(html, /<title>&lt;\/title&gt;&lt;script&gt;/);
  // Category deletion through the API also requires the CSRF token.
  const token = c.csrf;
  c.csrf = null;
  assert.equal((await c.del(`/api/admin/categories/${cat.id}?videos=delete`)).status, 403);
  c.csrf = token;
  assert.equal((await c.del(`/api/admin/categories/${cat.id}?videos=delete&videos=move`)).status, 409, 'ambiguous mode is refused');
  assert.equal((await c.del(`/api/admin/categories/${cat.id}?videos=delete`)).status, 200);
});
