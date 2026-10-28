'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, Client, FAKE, videoForm } = require('./helpers');

let srv;
let admin;
let categories;

test.before(async () => {
  srv = await startServer();
  admin = new Client(srv.base);
  assert.equal((await admin.login()).status, 200);
  categories = (await admin.get('/api/admin/categories')).data.categories;
});
test.after(() => srv.close());

test('default categories are seeded', () => {
  assert.deepEqual(categories.map((c) => c.slug), ['youtube-videos', 'youtube-shorts', 'instagram-reels', 'tiktok']);
});

test('home page renders with initial data and empty portfolio', async () => {
  const res = await fetch(srv.base + '/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /<title>Your Name — Video Editor<\/title>/);
  const json = html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/)[1];
  const data = JSON.parse(json);
  assert.equal(data.videos.length, 0);
  assert.equal(data.categories.length, 0, 'empty categories are hidden from visitors');
});

test('add videos from every platform by link', async () => {
  const shorts = categories.find((c) => c.slug === 'youtube-shorts');
  const links = [
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'landscape'],
    ['https://www.youtube.com/shorts/eRsGyueVLvQ', 'youtube_short', 'portrait'],
    ['https://www.instagram.com/reel/C1a2B3c4D5e/', 'instagram', 'portrait'],
    ['https://www.tiktok.com/@creator/video/7311111111111111111', 'tiktok', 'portrait'],
    ['https://vimeo.com/76979871', 'vimeo', 'landscape'],
  ];
  for (const [url, platform, orientation] of links) {
    const res = await admin.req('POST', '/api/admin/videos', {
      form: videoForm({ sourceType: 'link', url, title: `Clip ${platform}`, categoryId: shorts.id, client: 'ACME', tags: 'a, b,,c' }),
    });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.video.platform, platform);
    assert.equal(res.data.video.orientation, orientation);
    assert.deepEqual(res.data.video.tags, ['a', 'b', 'c']);
    assert.ok(res.data.video.embedUrl.startsWith('https://'));
  }
  const list = (await admin.get('/api/admin/videos')).data.videos;
  assert.equal(list.length, 5);
  assert.equal(list[0].title, 'Clip vimeo', 'newest first');
});

test('parse-url preview endpoint', async () => {
  const ok = await admin.post('/api/admin/parse-url', { url: 'youtu.be/aqz-KE-bpKQ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.platform, 'youtube');
  assert.equal(ok.data.thumbnail, 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg');
  const bad = await admin.post('/api/admin/parse-url', { url: 'https://example.com/video' });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.field, 'url');
});

test('upload a video file with thumbnail, serve it, then replace and delete it', async () => {
  const res = await admin.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'upload', title: 'My upload', orientation: 'portrait' }, {
      video: [FAKE.mp4(), 'clip.mp4', 'video/mp4'],
      thumbnail: [FAKE.png(), 'cover.png', 'image/png'],
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const v = res.data.video;
  assert.match(v.videoUrl, /^\/media\/videos\/[a-f0-9]{32}\.mp4$/);
  assert.match(v.thumbnail, /^\/media\/images\/[a-f0-9]{32}\.png$/);
  assert.equal(v.orientation, 'portrait');

  const media = await fetch(srv.base + v.videoUrl);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
  assert.match(media.headers.get('content-security-policy'), /sandbox/);

  // Range requests (needed for video seeking).
  const ranged = await fetch(srv.base + v.videoUrl, { headers: { range: 'bytes=0-9' } });
  assert.equal(ranged.status, 206);

  // Replace the file: the old one must be deleted from disk.
  const oldFile = path.join(srv.config.uploadDir, 'videos', path.basename(v.videoUrl));
  assert.ok(fs.existsSync(oldFile));
  const upd = await admin.req('PUT', `/api/admin/videos/${v.id}`, {
    form: videoForm({ sourceType: 'upload', title: 'My upload v2' }, { video: [FAKE.webm(), 'clip.webm', 'video/webm'] }),
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.match(upd.data.video.videoUrl, /\.webm$/);
  assert.ok(!fs.existsSync(oldFile), 'old video file removed');
  assert.equal(upd.data.video.thumbnail, v.thumbnail, 'thumbnail kept');

  // Switch the same entry to a link: uploaded file is removed.
  const newFile = path.join(srv.config.uploadDir, 'videos', path.basename(upd.data.video.videoUrl));
  const sw = await admin.req('PUT', `/api/admin/videos/${v.id}`, {
    form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'Now a link', removeThumbnail: '1' }),
  });
  assert.equal(sw.status, 200, JSON.stringify(sw.data));
  assert.equal(sw.data.video.platform, 'youtube');
  assert.ok(!fs.existsSync(newFile));
  assert.equal(sw.data.video.thumbnail, 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg');

  const del = await admin.del(`/api/admin/videos/${v.id}`);
  assert.equal(del.status, 200);
  assert.equal((await admin.del(`/api/admin/videos/${v.id}`)).status, 404);
  // No files left behind (tmp folder empty too).
  assert.deepEqual(fs.readdirSync(path.join(srv.config.uploadDir, 'videos')), []);
  assert.deepEqual(fs.readdirSync(path.join(srv.config.uploadDir, 'tmp')), []);
});

test('featured flag is unique per category and publish toggle hides videos', async () => {
  const list = (await admin.get('/api/admin/videos')).data.videos;
  const [a, b] = list;
  assert.equal((await admin.patch(`/api/admin/videos/${a.id}`, { featured: true })).status, 200);
  assert.equal((await admin.patch(`/api/admin/videos/${b.id}`, { featured: true })).status, 200);
  const after = (await admin.get('/api/admin/videos')).data.videos;
  assert.equal(after.filter((v) => v.featured).length, 1);
  assert.equal(after.find((v) => v.featured).id, b.id);

  await admin.patch(`/api/admin/videos/${a.id}`, { published: false });
  const pub = (await fetch(`${srv.base}/api/portfolio`).then((r) => r.json()));
  assert.ok(!pub.videos.some((v) => v.id === a.id), 'drafts are not public');
  assert.ok(!('published' in pub.videos[0]), 'admin-only fields are not exposed');
  await admin.patch(`/api/admin/videos/${a.id}`, { published: true });
});

test('reorder videos', async () => {
  const ids = (await admin.get('/api/admin/videos')).data.videos.map((v) => v.id).reverse();
  assert.equal((await admin.post('/api/admin/videos/reorder', { ids })).status, 200);
  assert.deepEqual((await admin.get('/api/admin/videos')).data.videos.map((v) => v.id), ids);
  assert.equal((await admin.post('/api/admin/videos/reorder', { ids: ['1; DROP TABLE videos'] })).status, 400);
});

test('a video must belong to an existing category', async () => {
  const none = await admin.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'x', categoryId: '' }) });
  assert.equal(none.status, 400);
  assert.equal(none.data.field, 'categoryId');
  const ghost = await admin.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'x', categoryId: 9999 }) });
  assert.equal(ghost.status, 400);
});

test('category CRUD and safe deletion (409 / move / delete)', async () => {
  const c = await admin.post('/api/admin/categories', { name: 'Commercials', description: 'Ads' });
  assert.equal(c.status, 201);
  assert.equal(c.data.category.slug, 'commercials');
  assert.equal((await admin.post('/api/admin/categories', { name: 'commercials!' })).status, 400, 'duplicate slug');
  const ren = await admin.put(`/api/admin/categories/${c.data.category.id}`, { name: 'Brand Ads' });
  assert.equal(ren.data.category.slug, 'brand-ads');
  const cid = c.data.category.id;

  // Put two videos in it: one link, one upload.
  const v1 = (await admin.req('POST', '/api/admin/videos', { form: videoForm({ sourceType: 'link', url: 'https://youtu.be/aqz-KE-bpKQ', title: 'Ad 1', categoryId: cid }) })).data.video;
  const v2 = (await admin.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'upload', title: 'Ad 2', categoryId: cid }, { video: [FAKE.mp4(), 'a.mp4', 'video/mp4'] }),
  })).data.video;

  const blocked = await admin.del(`/api/admin/categories/${cid}`);
  assert.equal(blocked.status, 409, 'cannot silently orphan videos');
  assert.equal(blocked.data.videoCount, 2);
  assert.equal((await admin.del(`/api/admin/categories/${cid}?videos=move&to=${cid}`)).status, 400, 'cannot move into itself');
  assert.equal((await admin.del(`/api/admin/categories/${cid}?videos=move&to=99999`)).status, 400);

  // Move to another category.
  const target = categories[0].id;
  const moved = await admin.del(`/api/admin/categories/${cid}?videos=move&to=${target}`);
  assert.equal(moved.status, 200);
  assert.equal(moved.data.moved, 2);
  const after = (await admin.get('/api/admin/videos')).data.videos;
  assert.ok([v1.id, v2.id].every((id) => after.find((v) => v.id === id).categoryId === target));

  // Delete with videos: files are removed too.
  const c2 = (await admin.post('/api/admin/categories', { name: 'Temp' })).data.category;
  const v3 = (await admin.req('POST', '/api/admin/videos', {
    form: videoForm({ sourceType: 'upload', title: 'Temp clip', categoryId: c2.id }, { video: [FAKE.mp4(), 'a.mp4', 'video/mp4'] }),
  })).data.video;
  const file = path.join(srv.config.uploadDir, 'videos', path.basename(v3.videoUrl));
  assert.ok(fs.existsSync(file));
  const del = await admin.del(`/api/admin/categories/${c2.id}?videos=delete`);
  assert.equal(del.data.deleted, 1);
  assert.ok(!fs.existsSync(file));
  assert.ok(!(await admin.get('/api/admin/videos')).data.videos.some((v) => v.id === v3.id));

  assert.equal((await admin.del('/api/admin/categories/99999')).status, 404);
  await admin.del(`/api/admin/videos/${v1.id}`);
  await admin.del(`/api/admin/videos/${v2.id}`);
});

test('category pages: listing, 404s, sitemap and admin covers', async () => {
  const cats = (await admin.get('/api/admin/categories')).data.categories;
  const withVideos = cats.find((c) => c.videoCount > 0);
  assert.ok(withVideos.cover, 'admin categories include a cover image');

  const res = await fetch(`${srv.base}/category/${withVideos.slug}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, new RegExp(`<title>${withVideos.name} — `));
  assert.match(html, /data-page="category"/);
  const data = JSON.parse(html.match(/<script type="application\/json" id="initial-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.category.slug, withVideos.slug);
  assert.ok(data.videos.length > 0 && data.videos.every((v) => v.categoryId === withVideos.id));

  const empty = cats.find((c) => c.videoCount === 0);
  if (empty) assert.equal((await fetch(`${srv.base}/category/${empty.slug}`)).status, 200, 'empty category shows a friendly page');
  for (const bad of ['nope', '..%2f..%2fserver.js', 'UPPER', '%3Cscript%3E']) {
    assert.equal((await fetch(`${srv.base}/category/${bad}`)).status, 404, bad);
  }
  // Raw templates are not reachable as static files.
  assert.equal((await fetch(`${srv.base}/category.html`)).status, 404);
  const sitemap = await fetch(`${srv.base}/sitemap.xml`).then((r) => r.text());
  assert.match(sitemap, new RegExp(`/category/${withVideos.slug}<`));

  const pub = await fetch(`${srv.base}/api/portfolio`).then((r) => r.json());
  assert.ok(pub.categories.every((c) => c.videoCount > 0 && ['landscape', 'portrait', 'square'].includes(c.orientation)));
});

test('settings update and validation', async () => {
  const res = await admin.put('/api/admin/settings', {
    site_name: 'Alex Cuts', accent_color: '#22C55E', social_youtube: 'https://youtube.com/@alex', contact_email: 'alex@example.com',
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.settings.accent_color, '#22c55e');
  const html = await fetch(srv.base + '/').then((r) => r.text());
  assert.match(html, /<title>Alex Cuts — Video Editor<\/title>/);

  assert.equal((await admin.put('/api/admin/settings', { accent_color: 'red;}body{display:none' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { contact_email: 'not-an-email' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { showreel_video_id: '999999' })).status, 400);

  const vid = (await admin.get('/api/admin/videos')).data.videos[0];
  assert.equal((await admin.put('/api/admin/settings', { showreel_video_id: String(vid.id) })).status, 200);
  const pub = await fetch(`${srv.base}/api/portfolio`).then((r) => r.json());
  assert.equal(pub.showreel.id, vid.id);
  // Deleting the showreel video clears the setting.
  await admin.del(`/api/admin/videos/${vid.id}`);
  assert.equal((await fetch(`${srv.base}/api/portfolio`).then((r) => r.json())).showreel, null);
});

test('avatar upload and removal', async () => {
  const up = await admin.req('POST', '/api/admin/settings/avatar', { form: videoForm({}, { avatar: [FAKE.jpg(), 'me.jpg', 'image/jpeg'] }) });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.match(up.data.settings.avatar, /^\/media\/images\/[a-f0-9]{32}\.jpg$/);
  const file = path.join(srv.config.uploadDir, 'images', path.basename(up.data.settings.avatar));
  assert.ok(fs.existsSync(file));
  const rm = await admin.del('/api/admin/settings/avatar');
  assert.equal(rm.data.settings.avatar, null);
  assert.ok(!fs.existsSync(file));
});

test('contact form stores messages; admin can read and delete them', async () => {
  const visitor = new Client(srv.base);
  const sent = await visitor.post('/api/contact', { name: 'Sam', email: 'sam@example.com', subject: 'Hi', message: 'I need 10 shorts edited.' });
  assert.equal(sent.status, 201);
  assert.equal((await visitor.post('/api/contact', { name: 'Sam', email: 'bad', message: 'I need 10 shorts edited.' })).status, 400);
  assert.equal((await visitor.post('/api/contact', { name: 'Sam', email: 'sam@example.com', message: 'short' })).status, 400);
  // Honeypot: accepted silently, but not stored.
  assert.equal((await visitor.post('/api/contact', { name: 'Bot', email: 'b@b.co', message: 'Buy cheap stuff now!!', website: 'spam.com' })).status, 201);

  const msgs = (await admin.get('/api/admin/messages')).data.messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].read, false);
  assert.equal((await admin.get('/api/admin/stats')).data.unreadMessages, 1);
  await admin.patch(`/api/admin/messages/${msgs[0].id}`, { read: true });
  assert.equal((await admin.get('/api/admin/stats')).data.unreadMessages, 0);
  assert.equal((await admin.del(`/api/admin/messages/${msgs[0].id}`)).status, 200);
});

test('misc public routes', async () => {
  assert.equal((await fetch(srv.base + '/healthz')).status, 200);
  assert.match(await fetch(srv.base + '/robots.txt').then((r) => r.text()), /Disallow: \/admin/);
  const nf = await fetch(srv.base + '/nope');
  assert.equal(nf.status, 404);
  assert.match(nf.headers.get('content-type'), /html/);
  const admin404 = await fetch(srv.base + '/api/nope');
  assert.equal(admin404.status, 404);
  const adm = await fetch(srv.base + '/admin');
  assert.equal(adm.status, 200);
  assert.equal(adm.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(adm.headers.get('cache-control'), 'no-store');
});
