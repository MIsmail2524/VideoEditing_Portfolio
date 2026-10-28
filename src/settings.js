'use strict';

const v = require('./validate');

/**
 * Every editable site setting is declared here. Anything not listed is rejected,
 * so the settings endpoint cannot be used to write arbitrary keys.
 */
const FIELDS = {
  site_name: { type: 'text', max: 80, default: 'Your Name' },
  role_title: { type: 'text', max: 80, default: 'Video Editor' },
  hero_heading: { type: 'text', max: 140, default: 'Edits that stop the scroll.' },
  hero_subheading: { type: 'multiline', max: 400, default: 'I craft high-retention YouTube videos, Shorts, Reels and TikToks for creators and brands — pacing, sound design, motion graphics and colour, all in one place.' },
  availability: { type: 'text', max: 80, default: 'Available for new projects' },
  location: { type: 'text', max: 80, default: '' },
  about_heading: { type: 'text', max: 140, default: 'Story first. Then every frame.' },
  about_text: { type: 'multiline', max: 4000, default: 'Tell visitors who you are, who you have worked with and how you approach an edit. You can change this text from the admin panel → Settings.' },
  skills: { type: 'text', max: 600, default: 'Storytelling, Retention editing, Motion graphics, Sound design, Colour grading, Subtitles & captions' },
  software: { type: 'text', max: 400, default: 'Premiere Pro, After Effects, DaVinci Resolve, CapCut, Photoshop' },
  services: { type: 'multiline', max: 3000, default: 'YouTube editing | Long-form videos edited for watch time with clean cuts, b-roll, graphics and sound design.\nShort-form content | Shorts, Reels and TikToks with strong hooks, captions and trend-aware pacing.\nBrand & ads | Product videos and paid social creatives built to convert.' },
  stat_1_value: { type: 'text', max: 20, default: '5+' },
  stat_1_label: { type: 'text', max: 40, default: 'Years editing' },
  stat_2_value: { type: 'text', max: 20, default: '300+' },
  stat_2_label: { type: 'text', max: 40, default: 'Videos delivered' },
  stat_3_value: { type: 'text', max: 20, default: '50M+' },
  stat_3_label: { type: 'text', max: 40, default: 'Views generated' },
  stat_4_value: { type: 'text', max: 20, default: '40+' },
  stat_4_label: { type: 'text', max: 40, default: 'Happy clients' },
  contact_heading: { type: 'text', max: 140, default: "Let's make something people can't scroll past." },
  contact_text: { type: 'multiline', max: 600, default: 'Tell me about your channel or brand, the type of videos you need and your timeline. I usually reply within 24 hours.' },
  contact_email: { type: 'email', default: '' },
  social_youtube: { type: 'url', default: '' },
  social_instagram: { type: 'url', default: '' },
  social_tiktok: { type: 'url', default: '' },
  social_linkedin: { type: 'url', default: '' },
  social_x: { type: 'url', default: '' },
  social_behance: { type: 'url', default: '' },
  social_vimeo: { type: 'url', default: '' },
  booking_url: { type: 'url', default: '' },
  seo_description: { type: 'text', max: 300, default: 'Video editor portfolio — YouTube videos, Shorts, Instagram Reels and TikTok edits.' },
  accent_color: { type: 'color', default: '#ff4d2e' },
  showreel_video_id: { type: 'int', default: '' },
  footer_text: { type: 'text', max: 200, default: '' },
};

// Managed by dedicated upload endpoints, never by the generic settings form.
const INTERNAL = { avatar_file: { default: '' } };

function readAll(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const [k, f] of Object.entries({ ...FIELDS, ...INTERNAL })) out[k] = f.default;
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out;
}

function validate(body) {
  const out = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!(key in body)) continue;
    switch (f.type) {
      case 'text': out[key] = v.str(body, key, { max: f.max }); break;
      case 'multiline': out[key] = v.str(body, key, { max: f.max, multiline: true }); break;
      case 'email': out[key] = v.email(body, key, { label: 'Contact email' }); break;
      case 'url': out[key] = v.httpsUrl(body, key, { label: key.replace(/_/g, ' ') }); break;
      case 'color': {
        const c = v.str(body, key, { max: 7 });
        if (c && !/^#[0-9a-fA-F]{6}$/.test(c)) throw new v.ValidationError('Accent colour must look like #ff4d2e.', key);
        out[key] = c.toLowerCase() || f.default;
        break;
      }
      case 'int': {
        const n = v.intField(body, key, { min: 1, fallback: null });
        out[key] = n === null ? '' : String(n);
        break;
      }
      default: break;
    }
  }
  return out;
}

function save(db, values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, val] of Object.entries(values)) stmt.run(k, String(val));
}

module.exports = { FIELDS, readAll, validate, save };
