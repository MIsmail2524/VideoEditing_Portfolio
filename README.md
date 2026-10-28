# Video Editor Portfolio

A dynamic portfolio website for video editors, with a secure admin panel to manage
**categories** and the **videos inside them** — YouTube videos, YouTube Shorts,
Instagram Reels, TikTok, Vimeo, or video files uploaded directly.

Everything on the website (videos, categories, texts, stats, services, social links,
photo, accent colour) is edited from the admin panel. No code changes needed.

---

## Features

### Public website
- **Home page**
  - Hero with name, headline, availability badge and stats
  - **Featured player**: the showreel (or a featured video) starts playing (muted) as soon as it scrolls into view
  - **One section per category** (e.g. *YouTube Videos*, *YouTube Shorts*, *Instagram Reels*, *TikTok*), each with a preview grid and a **View all** link
  - Clicking any video opens a full-screen **lightbox player** with previous/next
  - About, Services and Contact sections (contact form messages go to the admin inbox)
- **Category pages** — `/category/<name>`
  - Lists **all** videos of that category with a large player; visitors can watch any of them
  - Breadcrumbs, quick switch to other categories, shareable links (`?v=<id>`)
- Vertical videos (Shorts/Reels/TikTok) are shown in 9:16, long-form in 16:9 — automatically
- Responsive (phone → desktop), keyboard accessible, SEO meta tags, Open Graph, sitemap

### Admin panel — `/admin`
Organised as a hierarchy: **Portfolio → Category → Videos**

- **Portfolio**: create, rename, describe, reorder and delete categories
- **Category**: add videos to it, edit, delete, publish/unpublish, mark as *featured*, drag-and-drop ordering
- Deleting a category that still has videos asks what to do: **move them to another category** or **delete them too**
- **Add a video** by pasting a link (live preview + automatic platform/format detection) or by **uploading a file** (MP4/MOV/WebM, progress bar, automatic thumbnail from a frame)
- Custom cover images (recommended for Instagram, which does not provide thumbnails)
- **All videos** view with search and filters
- **Site content**: name, role, hero texts, stats, about, skills, services, contact, social links, showreel, accent colour, SEO
- **Messages** inbox for the contact form
- **Account**: change password, sign out other devices

---

## Quick start (local)

Requirements: **Node.js 22.13+** (Node 24 recommended). No database server needed — SQLite is built in.

```bash
npm install
cp .env.example .env
```

For local testing over plain `http://`, edit `.env`:

```
NODE_ENV=development
COOKIE_SECURE=false
SITE_URL=
TRUST_PROXY=
```

Create the admin account (asks for username + password, input is hidden):

```bash
npm run create-admin
```

Start:

```bash
npm start
```

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin

Optional — add a few sample videos to preview the layout (delete them later from the admin):

```bash
npm run seed-demo
```

---

## Adding portfolio videos

1. Sign in at `/admin` → **Portfolio**.
2. Open a category (or create one with **New category**).
3. Click **Add video to …** and either:
   - **Paste a link** — supported formats:
     | Platform | Example |
     |---|---|
     | YouTube | `https://www.youtube.com/watch?v=VIDEO_ID`, `https://youtu.be/VIDEO_ID` |
     | YouTube Shorts | `https://www.youtube.com/shorts/VIDEO_ID` |
     | Instagram | `https://www.instagram.com/reel/CODE/`, `https://www.instagram.com/p/CODE/` |
     | TikTok | `https://www.tiktok.com/@user/video/VIDEO_ID` (open short `vm.tiktok.com` links in a browser first and copy the full address) |
     | Vimeo | `https://vimeo.com/VIDEO_ID` |
   - **Upload a file** — MP4, MOV or WebM (default limit 500 MB, configurable).
4. Give it a title (client, tags, description optional) and save.

Tips:
- ★ **Featured** = the video that plays first on its category page (one per category).
- **Site content → Showreel** = the video that plays in the home page featured player.
- Drafts (unpublished videos) are hidden from visitors. Empty categories are hidden too.

Uploaded files are stored in `data/uploads/`, the database in `data/portfolio.db`.
**Back up the `data/` folder** regularly.

---

## Deployment

Any host that runs Node.js works (VPS, Render, Railway, Fly.io, Docker…).
Use a persistent disk/volume for the `data/` folder.

Production `.env`:

```
NODE_ENV=production
SITE_URL=https://www.your-domain.com      # required in production
COOKIE_SECURE=true
TRUST_PROXY=1                            # when behind nginx / Caddy / a platform proxy
MAX_VIDEO_MB=500
```

Create the admin on the server with `npm run create-admin`
(or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` for the **first** start only, then remove them).

### Docker

```bash
docker build -t portfolio .
docker run -d -p 3000:3000 --env-file .env -v portfolio-data:/app/data --name portfolio portfolio
docker exec -it portfolio node scripts/create-admin.js
```

### nginx (HTTPS reverse proxy)

```nginx
server {
    server_name www.your-domain.com;
    client_max_body_size 520m;          # allow large video uploads
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }
    # listen 443 ssl; + certificates (e.g. certbot)
}
```

---

## Security

- **Authentication**: scrypt password hashing, minimum 12-character passwords with mixed character classes, timing-safe comparison, no username enumeration
- **Brute-force protection**: account lock after 5 failed sign-ins (15 min) + per-IP rate limit
- **Sessions**: random 256-bit tokens stored only as SHA-256 hashes, `HttpOnly` + `SameSite=Strict` + `Secure` (`__Host-` prefix) cookies, idle (2 h) and absolute (12 h) expiry, server-side logout, password change signs out every other device
- **CSRF**: per-session token on every state-changing request + Origin / `Sec-Fetch-Site` checks
- **XSS**: strict Content-Security-Policy (no inline scripts/styles), all user content rendered as text, HTML-escaped server templates, JSON safely embedded
- **Video links**: parsed to strict IDs; embed/canonical URLs are rebuilt by the server (raw URLs are never rendered); only YouTube/Instagram/TikTok/Vimeo players may be framed
- **Uploads**: authentication + CSRF checked before any byte is written, file type detected from content (magic bytes, not the name), random file names, size limits, SVG/HTML rejected, temp files cleaned up, media served with `nosniff` + sandbox CSP
- **Input validation** on every field (lengths, types, https-only links, colours, emails); parameterised SQL everywhere
- Security headers (Helmet), HSTS in production, no stack traces in responses, admin pages `noindex` + `no-store`
- Contact form: honeypot, per-IP rate limit and global flood guard

Run the test suite (functional + attack tests: SQL injection, XSS, CSRF, session fixation/replay,
path traversal, malicious uploads, brute force, mass assignment, host-header injection…):

```bash
npm test
```

---

## Project structure

```
server.js              entry point
src/
  app.js               Express app, security headers, pages, static/media
  config.js            environment configuration
  db.js                SQLite schema + default categories
  security.js          password hashing, sessions
  embed.js             video link parsing (YouTube, Shorts, Instagram, TikTok, Vimeo)
  media.js             uploads, file-type detection, thumbnails
  portfolio.js         data shaping for pages and API
  settings.js          editable site content (whitelist + validation)
  validate.js          input validation helpers
  routes/public.js     public API (portfolio data, contact form)
  routes/admin.js      admin API
views/                 server-rendered page templates (home, category, 404)
public/                CSS, JS, fonts, admin panel
scripts/               create-admin, seed-demo
test/                  automated tests
```
