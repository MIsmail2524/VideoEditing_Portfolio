'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');

const database = require('./db');
const security = require('./security');
const media = require('./media');
const portfolio = require('./portfolio');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const FRAME_SOURCES = [
  'https://www.youtube-nocookie.com',
  'https://www.youtube.com',
  'https://www.instagram.com',
  'https://www.tiktok.com',
  'https://player.vimeo.com',
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON that is safe to embed inside an HTML <script type="application/json"> element. */
function jsonForHtml(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createApp(config) {
  const db = database.open(config);
  const sessions = security.createSessionStore(db, config);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');

  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        // Paths only (no query strings) so tokens or personal data never land in logs.
        console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: FRAME_SOURCES,
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'none'"],
        ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false, // third-party players (YouTube, TikTok…) do not send CORP headers
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // YouTube embeds require a referrer
    strictTransportSecurity: config.isProduction ? { maxAge: 63072000, includeSubDomains: true } : false,
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  // ---- API ----------------------------------------------------------------
  const expectedOrigin = config.siteUrl ? new URL(config.siteUrl).origin : null;
  const api = express.Router();

  // Reject cross-site state-changing requests before any body is read.
  api.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    const allowed = expectedOrigin || `${req.protocol}://${req.get('host')}`;
    if ((origin && origin !== allowed) || (site && !['same-origin', 'none'].includes(site))) {
      return res.status(403).json({ error: 'Cross-site request blocked.' });
    }
    next();
  });
  api.use(express.json({ limit: '100kb', strict: true, type: 'application/json' }));
  api.use('/', publicRoutes({ db, config }));
  api.use('/admin', adminRoutes({ db, config, sessions }));
  api.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use('/api', api);

  // ---- Uploaded media -----------------------------------------------------
  const mediaOptions = {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    fallthrough: true,
    immutable: true,
    maxAge: '30d',
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      res.set('Content-Type', media.CONTENT_TYPES[ext] || 'application/octet-stream');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', "default-src 'none'; sandbox");
      res.set('Cross-Origin-Resource-Policy', 'same-origin');
    },
  };
  app.use('/media/videos', express.static(path.join(config.uploadDir, media.DIRS.video), mediaOptions));
  app.use('/media/images', express.static(path.join(config.uploadDir, media.DIRS.image), mediaOptions));
  app.use('/media', (_req, res) => res.status(404).end());

  // ---- Pages --------------------------------------------------------------
  // HTML templates live outside public/ so their raw placeholders are never served.
  const viewsDir = path.join(config.root, 'views');
  const templates = {};
  function template(name) {
    if (!templates[name] || !config.isProduction) {
      templates[name] = fs.readFileSync(path.join(viewsDir, name), 'utf8');
    }
    return templates[name];
  }

  function baseUrl(req) {
    return config.siteUrl || `${req.protocol}://${req.get('host')}`;
  }

  // Cache-busting token for CSS/JS, derived from the files' contents.
  let assetVersion = null;
  function getAssetVersion() {
    if (!assetVersion || !config.isProduction) {
      const hash = crypto.createHash('sha256');
      for (const f of ['css/site.css', 'js/site.js']) hash.update(fs.readFileSync(path.join(config.publicDir, f)));
      assetVersion = hash.digest('hex').slice(0, 10);
    }
    return assetVersion;
  }

  function renderPage(req, res, name, { title, description, path: pagePath, image, data }) {
    const s = data.settings;
    const values = {
      ASSET_V: getAssetVersion(),
      TITLE: escapeHtml(title),
      DESCRIPTION: escapeHtml(description || s.seo_description),
      SITE_NAME: escapeHtml(s.site_name),
      CANONICAL: escapeHtml(`${baseUrl(req)}${pagePath}`),
      OG_IMAGE: escapeHtml(image && image.startsWith('/') ? `${baseUrl(req)}${image}` : image || ''),
      INITIAL_DATA: jsonForHtml(data),
    };
    // Single pass with a function replacer: inserted values are never re-scanned and "$&"-style
    // patterns inside user content are not interpreted.
    const html = template(name).replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => (key in values ? values[key] : m));
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  }

  function notFound(res) {
    res.status(404).type('html').send(template('404.html'));
  }

  app.get(['/', '/index.html'], (req, res) => {
    const data = portfolio.publicPayload(db);
    const s = data.settings;
    renderPage(req, res, 'index.html', {
      title: [s.site_name, s.role_title].filter(Boolean).join(' — '),
      path: '/',
      image: s.avatar || data.showreel?.thumbnail || data.videos[0]?.thumbnail,
      data,
    });
  });

  app.get('/category/:slug', (req, res) => {
    const slug = String(req.params.slug);
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) return notFound(res);
    const row = portfolio.getCategoryBySlug(db, slug);
    if (!row) return notFound(res);
    const data = portfolio.publicPayload(db);
    const videos = data.videos.filter((v) => v.categoryId === row.id);
    const [category] = portfolio.decorateCategories([{
      id: row.id, name: row.name, slug: row.slug, description: row.description, sortOrder: row.sort_order,
      videoCount: videos.length, publishedCount: videos.length,
    }], videos);
    const s = data.settings;
    renderPage(req, res, 'category.html', {
      title: `${row.name} — ${s.site_name}`,
      description: row.description || s.seo_description,
      path: `/category/${row.slug}`,
      image: category.cover,
      data: { settings: s, categories: data.categories, category, videos },
    });
  });

  app.get(['/admin', '/admin/'], (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const base = escapeHtml(baseUrl(req));
    const urls = [`${base}/`, ...portfolio.publicPayload(db).categories.map((c) => `${base}/category/${escapeHtml(c.slug)}`)];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`);
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use(express.static(config.publicDir, {
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}admin${path.sep}`)) {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.set('Cache-Control', 'no-cache'); // admin assets always revalidate after a deploy
      }
    },
  }));

  app.use((_req, res) => notFound(res));

  // ---- Errors -------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.expose ? err.message : 'Something went wrong. Please try again.';

    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large. The maximum video size is ${Math.round(config.maxVideoBytes / 1024 / 1024)} MB.`
        : 'Upload rejected.';
    } else if (err.type === 'entity.too.large') {
      message = 'Request is too large.';
    } else if (err.type === 'entity.parse.failed') {
      message = 'Malformed JSON.';
    }
    if (status >= 500) {
      console.error(`[error] ${req.method} ${req.path}`, err);
      message = 'Something went wrong. Please try again.';
    }
    if (req.files || req.file) media.discardUploads(req.files || [req.file]);
    if (res.headersSent) return res.end();
    const body = { error: message };
    if (err.field) body.field = err.field;
    res.status(status).json(body);
  });

  // ---- Housekeeping -------------------------------------------------------
  const timer = setInterval(() => {
    try { sessions.purgeExpired(); } catch (e) { console.error('[cleanup]', e); }
    media.cleanTmp(config).catch(() => {});
  }, 60 * 60 * 1000);
  timer.unref();
  media.cleanTmp(config).catch(() => {});

  app.locals.db = db;
  app.locals.close = () => {
    clearInterval(timer);
    db.close();
  };
  return app;
}

module.exports = { createApp, escapeHtml, jsonForHtml };
