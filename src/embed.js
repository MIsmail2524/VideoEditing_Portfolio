'use strict';

/**
 * Parses links from supported video platforms into a strict { platform, sourceId } pair.
 * Raw user URLs are never stored or rendered: embed and canonical links are rebuilt
 * from the validated IDs only, which rules out injection through the URL itself.
 */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IG_CODE = /^[A-Za-z0-9_-]{5,64}$/;
const TT_ID = /^\d{8,25}$/;
const TT_USER = /^[A-Za-z0-9._]{1,40}$/;
const VIMEO_ID = /^\d{5,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{6,32}$/;

class UrlError extends Error {}

function hostIs(host, ...domains) {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function parseVideoUrl(input) {
  if (typeof input !== 'string') throw new UrlError('Please paste a video link.');
  const raw = input.trim();
  if (!raw) throw new UrlError('Please paste a video link.');
  if (raw.length > 600) throw new UrlError('That link is too long.');

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new UrlError('That does not look like a valid link.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UrlError('Only http(s) links are supported.');
  if (url.username || url.password) throw new UrlError('That does not look like a valid link.');

  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // ---- YouTube ----------------------------------------------------------
  if (hostIs(host, 'youtube.com', 'youtube-nocookie.com', 'youtu.be')) {
    let id = null;
    let isShort = false;
    if (host === 'youtu.be') id = parts[0];
    else if (parts[0] === 'shorts') { id = parts[1]; isShort = true; }
    else if (['embed', 'live', 'v', 'e'].includes(parts[0])) id = parts[1];
    else if (parts[0] === 'watch' || url.pathname === '/watch') id = url.searchParams.get('v');
    if (!id || !YT_ID.test(id)) throw new UrlError('Could not find a YouTube video ID in that link.');
    return isShort
      ? { platform: 'youtube_short', sourceId: id, orientation: 'portrait' }
      : { platform: 'youtube', sourceId: id, orientation: 'landscape' };
  }

  // ---- Instagram ----------------------------------------------------------
  if (hostIs(host, 'instagram.com', 'instagr.am')) {
    // /reel/CODE, /reels/CODE, /p/CODE, /tv/CODE and /{username}/reel/CODE
    const idx = parts.findIndex((p) => ['reel', 'reels', 'p', 'tv'].includes(p));
    const kind = idx >= 0 ? parts[idx] : null;
    const code = idx >= 0 ? parts[idx + 1] : null;
    if (!code || !IG_CODE.test(code)) throw new UrlError('Could not find an Instagram post or reel in that link.');
    return { platform: 'instagram', sourceId: code, orientation: kind === 'p' ? 'square' : 'portrait' };
  }

  // ---- TikTok -------------------------------------------------------------
  if (hostIs(host, 'tiktok.com')) {
    if (['vm.tiktok.com', 'vt.tiktok.com'].includes(host) || parts[0] === 't') {
      throw new UrlError('TikTok short links are not supported. Open the link in a browser and copy the full address (tiktok.com/@user/video/…).');
    }
    let id = null;
    let user = null;
    const vIdx = parts.indexOf('video');
    if (vIdx >= 0) {
      id = parts[vIdx + 1];
      if (parts[0] && parts[0].startsWith('@')) user = parts[0].slice(1);
    } else if (parts[0] === 'embed') {
      id = parts[1] === 'v2' ? parts[2] : parts[1];
    } else if (parts[0] === 'player' && parts[1] === 'v1') {
      id = parts[2];
    } else if (parts[0] === 'v' && parts[1]) {
      id = parts[1].replace(/\.html$/, '');
    }
    if (!id || !TT_ID.test(id)) throw new UrlError('Could not find a TikTok video ID in that link.');
    const sourceUrlUser = user && TT_USER.test(user) ? user : null;
    return { platform: 'tiktok', sourceId: id, orientation: 'portrait', tiktokUser: sourceUrlUser };
  }

  // ---- Vimeo --------------------------------------------------------------
  if (hostIs(host, 'vimeo.com')) {
    let id = null;
    let hash = null;
    if (host === 'player.vimeo.com' && parts[0] === 'video') {
      id = parts[1];
      hash = url.searchParams.get('h');
    } else {
      const i = parts.findIndex((p) => VIMEO_ID.test(p));
      if (i >= 0) {
        id = parts[i];
        if (parts[i + 1] && VIMEO_HASH.test(parts[i + 1])) hash = parts[i + 1];
      }
    }
    if (!id || !VIMEO_ID.test(id)) throw new UrlError('Could not find a Vimeo video ID in that link.');
    const sourceId = hash && VIMEO_HASH.test(hash) ? `${id}:${hash}` : id;
    return { platform: 'vimeo', sourceId, orientation: 'landscape' };
  }

  throw new UrlError('Supported links: YouTube, YouTube Shorts, Instagram, TikTok and Vimeo.');
}

/** Validates a stored source id again before building URLs from it (defence in depth). */
function isValidSourceId(platform, sourceId) {
  if (typeof sourceId !== 'string') return false;
  switch (platform) {
    case 'youtube':
    case 'youtube_short':
      return YT_ID.test(sourceId);
    case 'instagram':
      return IG_CODE.test(sourceId);
    case 'tiktok':
      return TT_ID.test(sourceId);
    case 'vimeo': {
      const [id, hash] = sourceId.split(':');
      return VIMEO_ID.test(id) && (hash === undefined || VIMEO_HASH.test(hash));
    }
    default:
      return false;
  }
}

function embedUrl(platform, sourceId) {
  if (!isValidSourceId(platform, sourceId)) return null;
  switch (platform) {
    case 'youtube':
    case 'youtube_short':
      return `https://www.youtube-nocookie.com/embed/${sourceId}?rel=0&playsinline=1&modestbranding=1`;
    case 'instagram':
      return `https://www.instagram.com/p/${sourceId}/embed/`;
    case 'tiktok':
      return `https://www.tiktok.com/player/v1/${sourceId}?music_info=1&description=0&rel=0`;
    case 'vimeo': {
      const [id, hash] = sourceId.split(':');
      return `https://player.vimeo.com/video/${id}?dnt=1${hash ? `&h=${hash}` : ''}`;
    }
    default:
      return null;
  }
}

function canonicalUrl(platform, sourceId, extra = {}) {
  if (!isValidSourceId(platform, sourceId)) return null;
  switch (platform) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${sourceId}`;
    case 'youtube_short':
      return `https://www.youtube.com/shorts/${sourceId}`;
    case 'instagram':
      return `https://www.instagram.com/p/${sourceId}/`;
    case 'tiktok':
      return extra.tiktokUser && TT_USER.test(extra.tiktokUser)
        ? `https://www.tiktok.com/@${extra.tiktokUser}/video/${sourceId}`
        : `https://www.tiktok.com/embed/v2/${sourceId}`;
    case 'vimeo': {
      const [id, hash] = sourceId.split(':');
      return `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`;
    }
    default:
      return null;
  }
}

function remoteThumbnailUrl(platform, sourceId) {
  if (!isValidSourceId(platform, sourceId)) return null;
  if (platform === 'youtube' || platform === 'youtube_short') {
    return `https://i.ytimg.com/vi/${sourceId}/hqdefault.jpg`;
  }
  return null;
}

/** Only links we generated ourselves are accepted as stored source URLs. */
function isTrustedSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 300) return false;
  return /^https:\/\/(www\.youtube\.com\/(watch\?v=|shorts\/)|www\.instagram\.com\/p\/|www\.tiktok\.com\/(@|embed\/v2\/)|vimeo\.com\/)[A-Za-z0-9_.\-/=?:@]+$/.test(value);
}

const PLATFORM_LABELS = {
  youtube: 'YouTube',
  youtube_short: 'YouTube Shorts',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  vimeo: 'Vimeo',
  upload: 'Original',
};

module.exports = {
  parseVideoUrl,
  embedUrl,
  canonicalUrl,
  remoteThumbnailUrl,
  isValidSourceId,
  isTrustedSourceUrl,
  UrlError,
  PLATFORM_LABELS,
};
