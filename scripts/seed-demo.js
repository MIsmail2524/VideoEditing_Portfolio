'use strict';

/**
 * Adds a few public sample videos so the layout can be previewed before real work is added.
 * Every sample is marked "(sample)" and can be deleted from the admin panel.
 *
 *   npm run seed-demo
 */

const { load } = require('../src/config');
const database = require('../src/db');
const embed = require('../src/embed');

// Open-licence Blender Studio films hosted on YouTube.
const SAMPLES = [
  { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Big Buck Bunny (sample)', client: 'Blender Studio', category: 'youtube-videos', featured: true },
  { url: 'https://www.youtube.com/watch?v=eRsGyueVLvQ', title: 'Sintel (sample)', client: 'Blender Studio', category: 'youtube-videos' },
  { url: 'https://www.youtube.com/watch?v=R6MlUcmOul8', title: 'Tears of Steel (sample)', client: 'Blender Studio', category: 'youtube-videos' },
  { url: 'https://www.youtube.com/watch?v=WhWc3b3KhnY', title: 'Spring (sample)', client: 'Blender Studio', category: 'youtube-videos' },
];

const db = database.open(load());
const now = Date.now();
const insert = db.prepare(`INSERT INTO videos (title, description, client, tags, platform, source_id, source_url, orientation,
  category_id, featured, published, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);

SAMPLES.forEach((s, i) => {
  const p = embed.parseVideoUrl(s.url);
  const cat = db.prepare('SELECT id FROM categories WHERE slug = ?').get(s.category);
  insert.run(s.title, 'Sample entry to preview the layout. Delete it from the admin panel once you add your own work.', s.client,
    'Sample', p.platform, p.sourceId, embed.canonicalUrl(p.platform, p.sourceId, p), p.orientation, cat ? cat.id : null,
    s.featured ? 1 : 0, i, now - i, now - i);
});
console.log(`Added ${SAMPLES.length} sample videos.`);
db.close();
