'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const v = require('../validate');
const embed = require('../embed');
const media = require('../media');
const security = require('../security');
const settings = require('../settings');
const portfolio = require('../portfolio');
const { transaction, ORIENTATIONS } = require('../db');

const GENERIC_LOGIN_ERROR = 'Invalid username or password. After several failed attempts sign-in is paused for a few minutes.';

module.exports = function adminRoutes({ db, config, sessions }) {
  const router = express.Router();
  const uploader = media.createUploader(config);

  // Admin responses must never be cached by browsers or proxies.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.use((req, _res, next) => {
    req.session = sessions.load(req);
    next();
  });

  function requireAuth(req, res, next) {
    if (!req.session) return res.status(401).json({ error: 'Please sign in.' });
    next();
  }

  function requireCsrf(req, res, next) {
    const token = req.get('x-csrf-token');
    if (!req.session || !token || !security.safeEqual(token, req.session.csrfToken)) {
      return res.status(403).json({ error: 'Security token missing or invalid. Reload the page and try again.' });
    }
    next();
  }

  const guard = [requireAuth, requireCsrf];

  // ---------------------------------------------------------------- auth --
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts from your network. Try again in 15 minutes.' },
  });

  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const recordFailure = db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?');
  const lockUser = db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?');
  const resetFailures = db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?');

  router.post('/login', loginLimiter, async (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim().slice(0, 64) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password || password.length > security.MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Enter your username and password.' });
    }

    const user = findUser.get(username);
    const now = Date.now();
    if (!user) {
      await security.verifyPassword(password, await security.getDummyHash()); // equalise timing
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }
    if (user.locked_until > now) {
      await security.verifyPassword(password, await security.getDummyHash());
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }
    const ok = await security.verifyPassword(password, user.password_hash);
    if (!ok) {
      if (user.failed_attempts + 1 >= config.loginMaxAttempts) {
        // Lock, then reset the counter so the next lock needs another full set of failures.
        lockUser.run(now + config.loginLockMs, user.id);
      } else {
        recordFailure.run(user.id);
      }
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    resetFailures.run(user.id);
    sessions.destroy(req.session); // drop any pre-existing session before issuing a new one
    sessions.create(res, user.id, req);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    // Logout is allowed without CSRF only in the sense that it can only ever end a session.
    if (req.session) {
      const token = req.get('x-csrf-token');
      if (!token || !security.safeEqual(token, req.session.csrfToken)) {
        return res.status(403).json({ error: 'Security token missing or invalid.' });
      }
      sessions.destroy(req.session);
    }
    sessions.clearCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ username: req.session.username, csrfToken: req.session.csrfToken });
  });

  router.post('/password', guard, async (req, res) => {
    const body = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    if (!current || current.length > security.MAX_PASSWORD_LENGTH || !(await security.verifyPassword(current, user.password_hash))) {
      return res.status(400).json({ error: 'Current password is incorrect.', field: 'currentPassword' });
    }
    const problem = security.passwordProblem(body.newPassword, user.username);
    if (problem) return res.status(400).json({ error: problem, field: 'newPassword' });
    if (body.newPassword === current) return res.status(400).json({ error: 'Choose a password you have not used here.', field: 'newPassword' });

    const hash = await security.hashPassword(body.newPassword);
    const now = Date.now();
    transaction(db, () => {
      db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, now, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    });
    sessions.create(res, user.id, req); // every other device is signed out
    res.json({ ok: true });
  });

  router.post('/logout-others', guard, (req, res) => {
    sessions.destroyOthers(req.session);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ dashboard --
  router.get('/stats', requireAuth, (_req, res) => {
    const one = (sql) => db.prepare(sql).get().n;
    res.json({
      videos: one('SELECT COUNT(*) AS n FROM videos'),
      published: one('SELECT COUNT(*) AS n FROM videos WHERE published = 1'),
      drafts: one('SELECT COUNT(*) AS n FROM videos WHERE published = 0'),
      categories: one('SELECT COUNT(*) AS n FROM categories'),
      unreadMessages: one('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0'),
      uploads: one("SELECT COUNT(*) AS n FROM videos WHERE platform = 'upload'"),
      byPlatform: db.prepare('SELECT platform, COUNT(*) AS n FROM videos GROUP BY platform').all()
        .map((r) => ({ platform: r.platform, label: embed.PLATFORM_LABELS[r.platform], count: r.n })),
    });
  });

  // --------------------------------------------------------------- videos --
  router.get('/videos', requireAuth, (_req, res) => {
    res.json({ videos: portfolio.listVideos(db, { publishedOnly: false, admin: true }) });
  });

  router.post('/parse-url', guard, (req, res) => {
    try {
      const parsed = embed.parseVideoUrl((req.body || {}).url);
      res.json({
        platform: parsed.platform,
        platformLabel: embed.PLATFORM_LABELS[parsed.platform],
        orientation: parsed.orientation,
        embedUrl: embed.embedUrl(parsed.platform, parsed.sourceId),
        thumbnail: embed.remoteThumbnailUrl(parsed.platform, parsed.sourceId),
      });
    } catch (err) {
      if (err instanceof embed.UrlError) return res.status(400).json({ error: err.message, field: 'url' });
      throw err;
    }
  });

  const videoUpload = uploader.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);
  const categoryExists = db.prepare('SELECT 1 FROM categories WHERE id = ?');

  function readVideoFields(body) {
    // Every video belongs to exactly one category (Category -> Videos hierarchy).
    const categoryId = v.intField(body, 'categoryId', { min: 1, fallback: null, label: 'Category' });
    if (categoryId === null || !categoryExists.get(categoryId)) throw new v.ValidationError('Choose a category for this video.', 'categoryId');
    const tags = v.str(body, 'tags', { max: 300, label: 'Tags' })
      .split(',').map((t) => t.trim()).filter(Boolean).slice(0, 15).map((t) => t.slice(0, 40)).join(', ');
    return {
      title: v.str(body, 'title', { max: 150, required: true, label: 'Title' }),
      description: v.str(body, 'description', { max: 3000, multiline: true, label: 'Description' }),
      client: v.str(body, 'client', { max: 100, label: 'Client' }),
      tags,
      categoryId,
      orientation: v.oneOf(body, 'orientation', ORIENTATIONS, null),
      featured: v.bool(body, 'featured'),
      published: v.bool(body, 'published', true),
      sourceType: v.oneOf(body, 'sourceType', ['link', 'upload'], 'link'),
    };
  }

  function unfeatureOthers(categoryId, keepId) {
    db.prepare('UPDATE videos SET featured = 0 WHERE id != ? AND category_id IS ?').run(keepId, categoryId);
  }

  async function withUploads(req, fn) {
    const created = []; // stored files to roll back if the request fails
    try {
      return await fn(created);
    } catch (err) {
      await Promise.all(created.map(([kind, name]) => media.removeStored(config, kind, name)));
      if (err instanceof embed.UrlError) {
        err.status = 400;
        err.expose = true;
        err.field = 'url';
      }
      throw err;
    } finally {
      await media.discardUploads(req.files);
    }
  }

  router.post('/videos', guard, videoUpload, async (req, res) => {
    const result = await withUploads(req, async (created) => {
      const body = req.body || {};
      const f = readVideoFields(body);
      const files = req.files || {};
      let platform; let sourceId = null; let sourceUrl = null; let fileName = null; let thumb = null;
      let orientation = f.orientation;

      if (f.sourceType === 'upload') {
        if (!files.video) throw new v.ValidationError('Choose a video file to upload.', 'video');
        fileName = await media.commitUpload(config, files.video[0], 'video');
        created.push(['video', fileName]);
        platform = 'upload';
        orientation = orientation || 'landscape';
      } else {
        const parsed = embed.parseVideoUrl(body.url);
        platform = parsed.platform;
        sourceId = parsed.sourceId;
        sourceUrl = embed.canonicalUrl(platform, sourceId, parsed);
        orientation = orientation || parsed.orientation;
      }

      if (files.thumbnail) {
        thumb = await media.commitUpload(config, files.thumbnail[0], 'image');
        created.push(['image', thumb]);
      } else if (platform === 'tiktok' || platform === 'vimeo') {
        thumb = await media.fetchRemoteThumbnail(config, platform, sourceId, sourceUrl);
        if (thumb) created.push(['image', thumb]);
      }

      const now = Date.now();
      return transaction(db, () => {
        const minOrder = db.prepare('SELECT COALESCE(MIN(sort_order), 0) AS m FROM videos').get().m;
        const info = db.prepare(`INSERT INTO videos (title, description, client, tags, platform, source_id, source_url, file_name,
            thumbnail_file, orientation, category_id, featured, published, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          f.title, f.description, f.client, f.tags, platform, sourceId, sourceUrl, fileName, thumb, orientation,
          f.categoryId, f.featured ? 1 : 0, f.published ? 1 : 0, minOrder - 1, now, now,
        );
        const id = Number(info.lastInsertRowid);
        if (f.featured) unfeatureOthers(f.categoryId, id);
        return id;
      });
    });
    res.status(201).json({ video: portfolio.serializeVideo(portfolio.getVideoRow(db, result), { admin: true }) });
  });

  router.put('/videos/:id', guard, videoUpload, async (req, res) => {
    const id = v.idParam(req.params.id);
    const existing = portfolio.getVideoRow(db, id);
    if (!existing) {
      await media.discardUploads(req.files);
      return res.status(404).json({ error: 'Video not found.' });
    }
    const toDelete = [];
    await withUploads(req, async (created) => {
      const body = req.body || {};
      const f = readVideoFields(body);
      const files = req.files || {};
      let { platform, source_id: sourceId, source_url: sourceUrl, file_name: fileName, thumbnail_file: thumb } = existing;
      let orientation = f.orientation || existing.orientation;
      let sourceChanged = false;

      if (f.sourceType === 'upload') {
        if (files.video) {
          const name = await media.commitUpload(config, files.video[0], 'video');
          created.push(['video', name]);
          if (fileName) toDelete.push(['video', fileName]);
          fileName = name;
          sourceChanged = true;
        } else if (platform !== 'upload') {
          throw new v.ValidationError('Choose a video file to upload.', 'video');
        }
        platform = 'upload';
        sourceId = null;
        sourceUrl = null;
      } else if (typeof body.url === 'string' && body.url.trim()) {
        const parsed = embed.parseVideoUrl(body.url);
        if (parsed.platform !== platform || parsed.sourceId !== sourceId) {
          sourceChanged = true;
          if (!f.orientation) orientation = parsed.orientation;
        }
        platform = parsed.platform;
        sourceId = parsed.sourceId;
        sourceUrl = embed.canonicalUrl(platform, sourceId, parsed);
        if (fileName) toDelete.push(['video', fileName]);
        fileName = null;
      } else if (platform === 'upload') {
        throw new v.ValidationError('Paste a video link.', 'url');
      }

      if (files.thumbnail) {
        const name = await media.commitUpload(config, files.thumbnail[0], 'image');
        created.push(['image', name]);
        if (thumb) toDelete.push(['image', thumb]);
        thumb = name;
      } else if (v.bool(body, 'removeThumbnail') || (sourceChanged && platform !== 'upload')) {
        if (thumb) toDelete.push(['image', thumb]);
        thumb = null;
        if (platform === 'tiktok' || platform === 'vimeo') {
          thumb = await media.fetchRemoteThumbnail(config, platform, sourceId, sourceUrl);
          if (thumb) created.push(['image', thumb]);
        }
      }

      transaction(db, () => {
        db.prepare(`UPDATE videos SET title = ?, description = ?, client = ?, tags = ?, platform = ?, source_id = ?, source_url = ?,
            file_name = ?, thumbnail_file = ?, orientation = ?, category_id = ?, featured = ?, published = ?, updated_at = ?
          WHERE id = ?`).run(
          f.title, f.description, f.client, f.tags, platform, sourceId, sourceUrl, fileName, thumb, orientation,
          f.categoryId, f.featured ? 1 : 0, f.published ? 1 : 0, Date.now(), id,
        );
        if (f.featured) unfeatureOthers(f.categoryId, id);
      });
    });
    await Promise.all(toDelete.map(([kind, name]) => media.removeStored(config, kind, name)));
    res.json({ video: portfolio.serializeVideo(portfolio.getVideoRow(db, id), { admin: true }) });
  });

  router.patch('/videos/:id', guard, (req, res) => {
    const id = v.idParam(req.params.id);
    const existing = portfolio.getVideoRow(db, id);
    if (!existing) return res.status(404).json({ error: 'Video not found.' });
    const body = req.body || {};
    const featured = 'featured' in body ? v.bool(body, 'featured') : Boolean(existing.featured);
    const published = 'published' in body ? v.bool(body, 'published') : Boolean(existing.published);
    transaction(db, () => {
      db.prepare('UPDATE videos SET featured = ?, published = ?, updated_at = ? WHERE id = ?')
        .run(featured ? 1 : 0, published ? 1 : 0, Date.now(), id);
      if (featured) unfeatureOthers(existing.category_id, id);
    });
    res.json({ video: portfolio.serializeVideo(portfolio.getVideoRow(db, id), { admin: true }) });
  });

  router.post('/videos/reorder', guard, (req, res) => {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || ids.length > 5000 || !ids.every((x) => Number.isInteger(x) && x > 0)) {
      return res.status(400).json({ error: 'Invalid order.' });
    }
    const stmt = db.prepare('UPDATE videos SET sort_order = ? WHERE id = ?');
    transaction(db, () => ids.forEach((vid, i) => stmt.run(i, vid)));
    res.json({ ok: true });
  });

  router.delete('/videos/:id', guard, async (req, res) => {
    const id = v.idParam(req.params.id);
    const existing = portfolio.getVideoRow(db, id);
    if (!existing) return res.status(404).json({ error: 'Video not found.' });
    transaction(db, () => {
      db.prepare('DELETE FROM videos WHERE id = ?').run(id);
      db.prepare("UPDATE settings SET value = '' WHERE key = 'showreel_video_id' AND value = ?").run(String(id));
    });
    await media.removeStored(config, 'video', existing.file_name);
    await media.removeStored(config, 'image', existing.thumbnail_file);
    res.json({ ok: true });
  });

  // ----------------------------------------------------------- categories --
  function adminCategories() {
    const videos = portfolio.listVideos(db, { publishedOnly: false, admin: true });
    return portfolio.decorateCategories(portfolio.listCategories(db, { publishedOnly: false }), videos);
  }

  router.get('/categories', requireAuth, (_req, res) => {
    res.json({ categories: adminCategories() });
  });

  function readCategory(body, currentId = null) {
    const name = v.str(body, 'name', { max: 60, required: true, label: 'Name' });
    const description = v.str(body, 'description', { max: 300, multiline: true, label: 'Description' });
    const slug = v.slugify(v.str(body, 'slug', { max: 60 }) || name);
    if (!slug) throw new v.ValidationError('Name must contain letters or numbers.', 'name');
    const clash = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
    if (clash && clash.id !== currentId) throw new v.ValidationError('A category with this name already exists.', 'name');
    return { name, description, slug };
  }

  router.post('/categories', guard, (req, res) => {
    const c = readCategory(req.body || {});
    if (db.prepare('SELECT COUNT(*) AS n FROM categories').get().n >= 50) {
      return res.status(400).json({ error: 'You can have at most 50 categories.' });
    }
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories').get().m;
    const info = db.prepare('INSERT INTO categories (name, slug, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(c.name, c.slug, c.description, max + 1, Date.now());
    const cat = adminCategories().find((x) => x.id === Number(info.lastInsertRowid));
    res.status(201).json({ category: cat });
  });

  router.put('/categories/:id', guard, (req, res) => {
    const id = v.idParam(req.params.id);
    if (!categoryExists.get(id)) return res.status(404).json({ error: 'Category not found.' });
    const c = readCategory(req.body || {}, id);
    db.prepare('UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?').run(c.name, c.slug, c.description, id);
    res.json({ category: adminCategories().find((x) => x.id === id) });
  });

  router.post('/categories/reorder', guard, (req, res) => {
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every((x) => Number.isInteger(x) && x > 0)) {
      return res.status(400).json({ error: 'Invalid order.' });
    }
    const stmt = db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?');
    transaction(db, () => ids.forEach((cid, i) => stmt.run(i, cid)));
    res.json({ ok: true });
  });

  /**
   * Deleting a category that still holds videos requires an explicit decision:
   *   ?videos=move&to=<categoryId>  moves them to another category
   *   ?videos=delete                deletes them (and their uploaded files)
   */
  router.delete('/categories/:id', guard, async (req, res) => {
    const id = v.idParam(req.params.id);
    if (!categoryExists.get(id)) return res.status(404).json({ error: 'Category not found.' });
    const rows = db.prepare('SELECT id, file_name, thumbnail_file FROM videos WHERE category_id = ?').all(id);
    const mode = req.query.videos;

    if (rows.length && mode !== 'move' && mode !== 'delete') {
      return res.status(409).json({ error: 'This category still contains videos. Move them to another category or delete them too.', videoCount: rows.length });
    }
    if (rows.length && mode === 'move') {
      const target = v.idParam(req.query.to ?? '');
      if (target === id || !categoryExists.get(target)) throw new v.ValidationError('Choose another category to move the videos to.', 'to');
      transaction(db, () => {
        db.prepare('UPDATE videos SET category_id = ?, featured = 0, updated_at = ? WHERE category_id = ?').run(target, Date.now(), id);
        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      });
      return res.json({ ok: true, moved: rows.length });
    }

    transaction(db, () => {
      if (rows.length) {
        const ids = rows.map((r) => String(r.id));
        db.prepare(`UPDATE settings SET value = '' WHERE key = 'showreel_video_id' AND value IN (${ids.map(() => '?').join(',')})`).run(...ids);
        db.prepare('DELETE FROM videos WHERE category_id = ?').run(id);
      }
      db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    for (const r of rows) {
      await media.removeStored(config, 'video', r.file_name);
      await media.removeStored(config, 'image', r.thumbnail_file);
    }
    res.json({ ok: true, deleted: rows.length });
  });

  // ------------------------------------------------------------- settings --
  function adminSettings() {
    const s = settings.readAll(db);
    const out = {};
    for (const key of Object.keys(settings.FIELDS)) out[key] = s[key];
    out.avatar = media.publicPath('image', s.avatar_file);
    return out;
  }

  router.get('/settings', requireAuth, (_req, res) => res.json({ settings: adminSettings() }));

  router.put('/settings', guard, (req, res) => {
    const values = settings.validate(req.body || {});
    if (values.showreel_video_id && !db.prepare('SELECT 1 FROM videos WHERE id = ?').get(Number(values.showreel_video_id))) {
      throw new v.ValidationError('The selected showreel video no longer exists.', 'showreel_video_id');
    }
    transaction(db, () => settings.save(db, values));
    res.json({ settings: adminSettings() });
  });

  const avatarUpload = uploader.single('avatar');

  router.post('/settings/avatar', guard, avatarUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose an image.' });
    let name;
    try {
      name = await media.commitUpload(config, req.file, 'image');
    } finally {
      await media.discardUploads(req.file ? [req.file] : null);
    }
    const old = settings.readAll(db).avatar_file;
    settings.save(db, { avatar_file: name });
    await media.removeStored(config, 'image', old);
    res.json({ settings: adminSettings() });
  });

  router.delete('/settings/avatar', guard, async (_req, res) => {
    const old = settings.readAll(db).avatar_file;
    settings.save(db, { avatar_file: '' });
    await media.removeStored(config, 'image', old);
    res.json({ settings: adminSettings() });
  });

  // ------------------------------------------------------------- messages --
  router.get('/messages', requireAuth, (_req, res) => {
    const rows = db.prepare('SELECT id, name, email, subject, body, is_read, created_at FROM messages ORDER BY created_at DESC LIMIT 500').all();
    res.json({
      messages: rows.map((r) => ({
        id: r.id, name: r.name, email: r.email, subject: r.subject, body: r.body, read: Boolean(r.is_read), createdAt: r.created_at,
      })),
    });
  });

  router.patch('/messages/:id', guard, (req, res) => {
    const id = v.idParam(req.params.id);
    const info = db.prepare('UPDATE messages SET is_read = ? WHERE id = ?').run(v.bool(req.body || {}, 'read', true) ? 1 : 0, id);
    if (!info.changes) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  });

  router.delete('/messages/:id', guard, (req, res) => {
    const id = v.idParam(req.params.id);
    const info = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    if (!info.changes) return res.status(404).json({ error: 'Message not found.' });
    res.json({ ok: true });
  });

  return router;
};
