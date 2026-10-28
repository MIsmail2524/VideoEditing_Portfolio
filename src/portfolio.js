'use strict';

const embed = require('./embed');
const media = require('./media');
const settings = require('./settings');

const VIDEO_COLUMNS = `v.id, v.title, v.description, v.client, v.tags, v.platform, v.source_id, v.source_url,
  v.file_name, v.thumbnail_file, v.orientation, v.category_id, v.featured, v.published, v.sort_order,
  v.created_at, v.updated_at`;

function serializeVideo(row, { admin = false } = {}) {
  const isUpload = row.platform === 'upload';
  const thumb = media.publicPath('image', row.thumbnail_file) || embed.remoteThumbnailUrl(row.platform, row.source_id);
  const out = {
    id: row.id,
    title: row.title,
    description: row.description,
    client: row.client,
    tags: row.tags ? row.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    platform: row.platform,
    platformLabel: embed.PLATFORM_LABELS[row.platform] || row.platform,
    orientation: row.orientation,
    categoryId: row.category_id,
    featured: Boolean(row.featured),
    thumbnail: thumb,
    videoUrl: isUpload ? media.publicPath('video', row.file_name) : null,
    embedUrl: isUpload ? null : embed.embedUrl(row.platform, row.source_id),
    sourceUrl: !isUpload && embed.isTrustedSourceUrl(row.source_url) ? row.source_url : null,
    createdAt: row.created_at,
  };
  if (admin) {
    out.published = Boolean(row.published);
    out.sortOrder = row.sort_order;
    out.updatedAt = row.updated_at;
    out.hasCustomThumbnail = Boolean(row.thumbnail_file);
  }
  return out;
}

function serializeCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    videoCount: row.video_count ?? 0,
    publishedCount: row.published_count ?? 0,
  };
}

/**
 * Adds presentation hints derived from a category's videos:
 * a cover image (featured video first) and the dominant orientation used for its grid.
 */
function decorateCategories(categories, videos) {
  return categories.map((c) => {
    const own = videos.filter((v) => v.categoryId === c.id);
    const lead = own.find((v) => v.featured && v.thumbnail) || own.find((v) => v.thumbnail) || null;
    const counts = { landscape: 0, portrait: 0, square: 0 };
    own.forEach((v) => { counts[v.orientation] += 1; });
    const orientation = own.length
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
      : 'landscape';
    return { ...c, cover: lead ? lead.thumbnail : null, orientation };
  });
}

function listCategories(db, { publishedOnly = true } = {}) {
  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM videos v WHERE v.category_id = c.id ${publishedOnly ? 'AND v.published = 1' : ''}) AS video_count,
      (SELECT COUNT(*) FROM videos v WHERE v.category_id = c.id AND v.published = 1) AS published_count
    FROM categories c ORDER BY c.sort_order ASC, c.id ASC`).all();
  return rows.map(serializeCategory);
}

function getCategoryBySlug(db, slug) {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
}

function listVideos(db, { publishedOnly = true, admin = false } = {}) {
  const rows = db.prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v
    ${publishedOnly ? 'WHERE v.published = 1' : ''}
    ORDER BY v.sort_order ASC, v.created_at DESC, v.id DESC`).all();
  return rows.map((r) => serializeVideo(r, { admin }));
}

function getVideoRow(db, id) {
  return db.prepare(`SELECT ${VIDEO_COLUMNS} FROM videos v WHERE v.id = ?`).get(id);
}

/** Public-facing settings: only what the site needs to render. */
function publicSettings(db) {
  const s = settings.readAll(db);
  const out = {};
  for (const key of Object.keys(settings.FIELDS)) out[key] = s[key];
  out.avatar = media.publicPath('image', s.avatar_file);
  return out;
}

function publicPayload(db) {
  const s = publicSettings(db);
  const videos = listVideos(db);
  const categories = decorateCategories(listCategories(db).filter((c) => c.videoCount > 0), videos);
  const showreelId = Number(s.showreel_video_id) || null;
  const showreel = videos.find((vid) => vid.id === showreelId) || null;
  delete s.showreel_video_id;
  return { settings: s, categories, videos, showreel };
}

module.exports = { serializeVideo, listCategories, decorateCategories, getCategoryBySlug, listVideos, getVideoRow, publicPayload, publicSettings, VIDEO_COLUMNS };
