(() => {
  'use strict';

  // ------------------------------------------------------------------ utils --
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Builds DOM nodes. All text goes through textContent, never innerHTML. */
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // Static, trusted icon markup (never contains user data).
  const ICON_PATHS = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    youtube: '<path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8z"/><path d="M10 9.4v5.2l4.5-2.6z" fill="currentColor"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.6 2.3 4.4 5 4.6"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>',
    x: '<path d="M4 4l16 16M20 4L4 20"/>',
    behance: '<path d="M3 7h5a2.5 2.5 0 0 1 0 5H3zM3 12h5.5a2.5 2.5 0 0 1 0 5H3zM14 14h7a3.5 3.5 0 1 0-1 2.5M15 7h5"/>',
    vimeo: '<path d="M3 8.5l1 1.3s2-1.5 2.6-.8c.7.7 2.3 8.5 4 8.5s5.6-4.3 7.2-9.3c.8-2.5-.6-4.5-3.3-3-1 .6-2 2-2.3 3 1.8-1 3-.3 2.2 1.6-.9 2-2.8 4.4-3.5 4.4s-1.6-5.8-2.4-8C7.7 4 5.7 6 3 8.5z"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICON_PATHS[name] || ICON_PATHS.film;
    return s;
  }
  const platformIcon = (p) => ({ youtube: 'youtube', youtube_short: 'youtube', instagram: 'instagram', tiktok: 'tiktok', vimeo: 'vimeo' }[p] || 'film');

  const EMBED_PREFIXES = [
    'https://www.youtube-nocookie.com/embed/',
    'https://www.instagram.com/p/',
    'https://www.tiktok.com/player/v1/',
    'https://player.vimeo.com/video/',
  ];
  const isSafeEmbed = (u) => typeof u === 'string' && EMBED_PREFIXES.some((p) => u.startsWith(p));
  const isSafeLocal = (u) => typeof u === 'string' && /^\/media\/(videos|images)\/[a-f0-9]{32}\.[a-z0-9]{3,4}$/.test(u);
  const isSafeImage = (u) => isSafeLocal(u) || (typeof u === 'string' && u.startsWith('https://i.ytimg.com/'));
  const isHttps = (u) => typeof u === 'string' && /^https:\/\//i.test(u);
  const isSlug = (s) => typeof s === 'string' && /^[a-z0-9-]{1,60}$/.test(s);
  const categoryUrl = (c) => (c && isSlug(c.slug) ? `/category/${c.slug}` : '/#work');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const page = document.body.dataset.page;
  let data;
  try {
    data = JSON.parse($('#initial-data').textContent);
  } catch {
    data = null;
  }
  const categoryById = () => new Map((data.categories || []).map((c) => [c.id, c]));

  // ------------------------------------------------------------- settings --
  function renderSettings(s) {
    if (/^#[0-9a-f]{6}$/i.test(s.accent_color || '')) {
      document.documentElement.style.setProperty('--accent', s.accent_color);
      const rgb = parseInt(s.accent_color.slice(1), 16);
      const lum = (0.299 * (rgb >> 16) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255)) / 255;
      document.documentElement.style.setProperty('--accent-ink', lum > 0.62 ? '#0b0b0d' : '#ffffff');
    }
    $$('[data-bind]').forEach((el) => { el.textContent = s[el.dataset.bind] || ''; });
    $$('[data-requires]').forEach((el) => { el.hidden = !String(s[el.dataset.requires] || '').trim(); });
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();
    if (page !== 'home') return;

    const stats = $('#stats');
    stats.replaceChildren();
    for (let i = 1; i <= 4; i++) {
      const value = s[`stat_${i}_value`];
      if (value) stats.append(h('div', {}, h('dt', { text: value }), h('dd', { text: s[`stat_${i}_label`] || '' })));
    }
    stats.hidden = !stats.children.length;

    $('#about-text').replaceChildren(...String(s.about_text || '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => h('p', { text: p.trim() })));
    const photo = $('#about-photo');
    if (isSafeLocal(s.avatar)) {
      photo.replaceChildren(h('img', { src: s.avatar, alt: `Portrait of ${s.site_name}`, loading: 'lazy' }));
    } else {
      const initials = String(s.site_name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
      photo.replaceChildren(h('div', { class: 'monogram', text: initials || '▶' }));
    }
    const chips = (id, text) => {
      $(id).replaceChildren(...String(text || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => h('li', { text: t })));
    };
    chips('#skills', s.skills);
    chips('#software', s.software);

    const services = String(s.services || '').split('\n').map((l) => l.trim()).filter(Boolean);
    $('#service-grid').replaceChildren(...services.map((line, i) => {
      const [title, ...rest] = line.split('|');
      return h('article', { class: 'service' },
        h('p', { class: 'service-num', text: String(i + 1).padStart(2, '0') }),
        h('h3', { text: title.trim() }),
        rest.length ? h('p', { text: rest.join('|').trim() }) : null);
    }));

    const email = $('#contact-email');
    if (s.contact_email && /^[^\s@<>"]+@[^\s@<>"]+$/.test(s.contact_email)) {
      email.href = `mailto:${s.contact_email}`;
      email.textContent = s.contact_email;
      email.hidden = false;
    }
    const booking = $('#booking-link');
    if (isHttps(s.booking_url)) { booking.href = s.booking_url; booking.hidden = false; }
    const socialDefs = [
      ['social_youtube', 'youtube', 'YouTube'], ['social_instagram', 'instagram', 'Instagram'], ['social_tiktok', 'tiktok', 'TikTok'],
      ['social_linkedin', 'linkedin', 'LinkedIn'], ['social_x', 'x', 'X'], ['social_behance', 'behance', 'Behance'], ['social_vimeo', 'vimeo', 'Vimeo'],
    ];
    $('#socials').replaceChildren(...socialDefs.filter(([k]) => isHttps(s[k])).map(([k, ic, label]) => h('li', {},
      h('a', { href: s[k], target: '_blank', rel: 'noopener noreferrer me', 'aria-label': label, title: label }, icon(ic)))));
  }

  // ---------------------------------------------------------------- player --
  function buildEmbedSrc(video, muted) {
    const u = new URL(video.embedUrl);
    if (video.platform === 'youtube' || video.platform === 'youtube_short') {
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('mute', muted ? '1' : '0');
    } else if (video.platform === 'vimeo') {
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('muted', muted ? '1' : '0');
    } else if (video.platform === 'tiktok') {
      u.searchParams.set('autoplay', '1');
      u.searchParams.set('loop', '1');
    }
    return u.href;
  }

  function frameFor(video) {
    return h('div', { class: `player-frame${video.platform === 'instagram' ? ' is-instagram' : ''}` });
  }

  /** Mounts the real player (iframe or <video>) for a video into a frame element. */
  function mountPlayer(frame, video, { muted }) {
    frame.replaceChildren();
    if (video.platform === 'upload' && isSafeLocal(video.videoUrl)) {
      const el = h('video', {
        src: video.videoUrl, controls: true, playsinline: true, autoplay: true, loop: true, preload: 'metadata',
        poster: isSafeImage(video.thumbnail) ? video.thumbnail : null, 'aria-label': video.title,
      });
      el.muted = muted;
      frame.append(el);
      el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
    } else if (isSafeEmbed(video.embedUrl)) {
      frame.append(h('iframe', {
        src: buildEmbedSrc(video, muted),
        title: video.title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
        sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
      }));
    } else {
      frame.append(h('span', { class: 'poster-fallback' }, icon('film')));
    }
  }

  function mountPoster(frame, video, onPlay) {
    const img = isSafeImage(video.thumbnail)
      ? h('img', { src: video.thumbnail, alt: '', decoding: 'async' })
      : h('span', { class: 'poster-fallback' }, icon(platformIcon(video.platform)));
    frame.replaceChildren(h('button', { class: 'player-poster', type: 'button', 'aria-label': `Play ${video.title}`, onclick: onPlay },
      img, h('span', { class: 'play-badge' }, icon('play'))));
  }

  function fillBadge(el, video) {
    el.textContent = video.platformLabel;
    el.dataset.platform = video.platform;
  }

  function sourceLink(el, video) {
    if (!el) return;
    if (isHttps(video.sourceUrl)) {
      el.href = video.sourceUrl;
      el.textContent = `Watch on ${video.platform === 'youtube_short' ? 'YouTube' : video.platformLabel} ↗`;
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  /**
   * The stage: one large player with details. Starts muted automatically when it
   * scrolls into view, so there is always one video playing.
   */
  function createStage({ onChange } = {}) {
    const stage = $('#stage');
    const state = { list: [], index: 0, autoStart: null, userStarted: false };

    function setOrientation(video) {
      stage.classList.toggle('is-portrait', video.orientation === 'portrait');
      stage.classList.toggle('is-square', video.orientation === 'square');
    }

    function visible() {
      const r = stage.getBoundingClientRect();
      return r.top < window.innerHeight * 0.75 && r.bottom > window.innerHeight * 0.25;
    }

    function show(index, { play = false, muted = true } = {}) {
      const video = state.list[index];
      if (!video) { stage.hidden = true; return; }
      state.index = index;
      stage.hidden = false;
      setOrientation(video);
      const frame = frameFor(video);
      $('#stage-player').replaceChildren(frame);
      state.autoStart = null;
      if (play) {
        mountPlayer(frame, video, { muted });
      } else {
        mountPoster(frame, video, () => { state.userStarted = true; mountPlayer(frame, video, { muted: false }); onChange?.(video, true); });
        state.autoStart = () => mountPlayer(frame, video, { muted: true });
        if (visible()) { state.autoStart(); state.autoStart = null; }
      }

      fillBadge($('#stage-platform'), video);
      const cat = categoryById().get(video.categoryId) || data.category;
      const catEl = $('#stage-category');
      if (catEl) catEl.textContent = cat?.name || '';
      $('#stage-title').textContent = video.title;
      $('#stage-client').textContent = video.client ? `Client: ${video.client}` : '';
      $('#stage-desc').textContent = video.description || '';
      $('#stage-tags').replaceChildren(...video.tags.map((t) => h('li', { text: t })));
      const count = $('#stage-count');
      if (count) count.textContent = `${index + 1} / ${state.list.length}`;
      ['#stage-prev', '#stage-next'].forEach((s) => { const b = $(s); if (b) b.disabled = state.list.length < 2; });
      const catLink = $('#stage-category-link');
      if (catLink && cat) {
        catLink.href = categoryUrl(cat);
        catLink.textContent = `More ${cat.name} →`;
        catLink.hidden = false;
      }
      sourceLink($('#stage-source'), video);
      onChange?.(video, play && !muted);
    }

    function stop() {
      const video = state.list[state.index];
      if (!video) return;
      const frame = frameFor(video);
      $('#stage-player').replaceChildren(frame);
      mountPoster(frame, video, () => { state.userStarted = true; mountPlayer(frame, video, { muted: false }); });
    }

    function step(delta) {
      if (state.list.length < 2) return;
      state.userStarted = true;
      show((state.index + delta + state.list.length) % state.list.length, { play: true, muted: false });
    }

    $('#stage-prev')?.addEventListener('click', () => step(-1));
    $('#stage-next')?.addEventListener('click', () => step(1));

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        for (const e of entries) {
          const vid = $('#stage-player video');
          if (e.isIntersecting) {
            if (state.autoStart) { state.autoStart(); state.autoStart = null; }
            if (vid && vid.paused && vid.dataset.autopaused) { delete vid.dataset.autopaused; vid.play().catch(() => {}); }
          } else if (vid && !vid.paused) {
            vid.dataset.autopaused = '1';
            vid.pause();
          }
        }
      }, { threshold: 0.35 }).observe(stage);
    }

    return {
      state,
      setList(list) { state.list = list; },
      show,
      stop,
      scrollTo() {
        const r = stage.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight * 0.4) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    };
  }

  // ------------------------------------------------------------------ cards --
  function card(video, { onPlay, showCategory = true } = {}) {
    const cats = categoryById();
    const media = h('div', { class: 'card-media' });
    if (isSafeImage(video.thumbnail)) {
      const img = h('img', { src: video.thumbnail, alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.replaceWith(h('span', { class: 'thumb-fallback' }, icon(platformIcon(video.platform)))), { once: true });
      media.append(img);
    } else {
      media.append(h('span', { class: 'thumb-fallback' }, icon(platformIcon(video.platform))));
    }
    media.append(
      h('span', { class: 'badge', text: video.platformLabel, dataset: { platform: video.platform } }),
      h('span', { class: 'card-play', 'aria-hidden': 'true' }, icon('play')),
    );
    const sub = [showCategory ? cats.get(video.categoryId)?.name : null, video.client].filter(Boolean).join(' · ');
    const el = h('button', { class: 'card', type: 'button', dataset: { id: video.id }, 'aria-label': `Play ${video.title}` },
      media,
      h('div', { class: 'card-body' }, h('p', { class: 'card-title', text: video.title }), sub ? h('p', { class: 'card-sub', text: sub }) : null));
    el.addEventListener('click', () => onPlay(video));

    // Hover preview for uploaded originals.
    if (video.platform === 'upload' && isSafeLocal(video.videoUrl) && window.matchMedia('(hover: hover)').matches) {
      let preview = null;
      el.addEventListener('mouseenter', () => {
        preview = h('video', { src: video.videoUrl, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true' });
        preview.muted = true;
        media.insertBefore(preview, media.children[1] || null);
        preview.play().then(() => el.classList.add('previewing')).catch(() => {});
      });
      el.addEventListener('mouseleave', () => {
        el.classList.remove('previewing');
        if (preview) { preview.pause(); preview.remove(); preview = null; }
      });
    }
    return el;
  }

  function markActive(grid, id) {
    $$('.card', grid).forEach((c) => {
      const active = Number(c.dataset.id) === id;
      c.classList.toggle('active', active);
      c.setAttribute('aria-current', active ? 'true' : 'false');
      const np = $('.now-playing', c);
      if (active && !np) $('.card-media', c).append(h('span', { class: 'now-playing', text: 'Now playing' }));
      if (!active && np) np.remove();
    });
  }

  function categoryNav(current = null) {
    const nav = $('#category-nav');
    if (!nav) return;
    nav.replaceChildren(...data.categories.map((c) => h('a', {
      class: 'category-chip', href: categoryUrl(c), 'aria-current': c.id === current ? 'page' : null,
    }, c.name, h('span', { class: 'count', text: String(c.videoCount) }))));
    nav.hidden = !data.categories.length;
    const active = $('[aria-current="page"]', nav);
    if (active) nav.scrollLeft = active.offsetLeft - nav.offsetLeft - 16;
  }

  // --------------------------------------------------------------- lightbox --
  function createLightbox({ onOpen } = {}) {
    const dlg = $('#lightbox');
    const state = { list: [], index: 0 };

    function show(index) {
      const video = state.list[index];
      if (!video) return;
      state.index = index;
      dlg.classList.toggle('is-portrait', video.orientation === 'portrait');
      dlg.classList.toggle('is-square', video.orientation === 'square');
      const frame = frameFor(video);
      $('#lb-player').replaceChildren(frame);
      mountPlayer(frame, video, { muted: false });
      fillBadge($('#lb-platform'), video);
      const cat = categoryById().get(video.categoryId);
      $('#lb-category').textContent = cat ? cat.name : '';
      $('#lb-title').textContent = video.title;
      $('#lb-client').textContent = video.client ? `Client: ${video.client}` : '';
      $('#lb-count').textContent = `${index + 1} / ${state.list.length}`;
      $('#lb-prev').disabled = state.list.length < 2;
      $('#lb-next').disabled = state.list.length < 2;
      const link = $('#lb-category-link');
      link.hidden = !cat;
      if (cat) {
        link.href = `${categoryUrl(cat)}?v=${video.id}`;
        link.textContent = `All ${cat.name} →`;
      }
    }

    function step(delta) {
      if (state.list.length > 1) show((state.index + delta + state.list.length) % state.list.length);
    }

    $('#lb-prev').addEventListener('click', () => step(-1));
    $('#lb-next').addEventListener('click', () => step(1));
    $('#lb-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
    dlg.addEventListener('close', () => {
      $('#lb-player').replaceChildren(); // stops playback
      document.body.classList.remove('no-scroll');
    });

    return {
      open(list, index) {
        state.list = list;
        onOpen?.();
        show(index);
        document.body.classList.add('no-scroll');
        if (!dlg.open) dlg.showModal();
        $('#lb-close').focus();
      },
    };
  }

  // ------------------------------------------------------------------- home --
  const LIMITS = { portrait: 6, square: 4, landscape: 6 };

  function renderHome() {
    const videos = data.videos;
    $('#empty-state').hidden = videos.length > 0;
    if (!videos.length) {
      $('#category-nav').hidden = true;
      return;
    }
    categoryNav();

    const stage = createStage();
    const featured = data.showreel || videos.find((v) => v.featured) || videos[0];
    stage.setList([featured]);
    stage.show(0);
    $('.stage-label').textContent = data.showreel ? 'Showreel' : 'Featured';

    const lightbox = createLightbox({ onOpen: () => stage.stop() });

    const sections = $('#category-sections');
    sections.replaceChildren(...data.categories.map((cat) => {
      const list = videos.filter((v) => v.categoryId === cat.id);
      const limit = LIMITS[cat.orientation] || 6;
      const shown = list.slice(0, limit);
      const grid = h('div', { class: 'vgrid', dataset: { orientation: cat.orientation } },
        shown.map((v) => card(v, { showCategory: false, onPlay: () => lightbox.open(list, list.indexOf(v)) })));
      return h('section', { class: 'cat-section', 'aria-labelledby': `cat-${cat.id}` },
        h('header', { class: 'cat-head' },
          h('div', {},
            h('h3', { id: `cat-${cat.id}` }, h('a', { href: categoryUrl(cat), text: cat.name })),
            cat.description ? h('p', { class: 'cat-desc', text: cat.description }) : null),
          h('a', { class: 'view-all', href: categoryUrl(cat) }, `View all ${cat.videoCount}`, icon('arrow'))),
        grid,
        list.length > limit
          ? h('div', { class: 'cat-more' }, h('a', { class: 'btn btn-ghost', href: categoryUrl(cat) }, `See all ${plural(list.length, 'video')} in ${cat.name}`, icon('arrow')))
          : null);
    }));

    if (data.showreel) {
      $('#hero-watch-label').textContent = 'Watch showreel';
      $('#hero-watch').addEventListener('click', (e) => {
        e.preventDefault();
        stage.state.userStarted = true;
        stage.show(0, { play: true, muted: false });
        stage.scrollTo();
      });
    }
  }

  // --------------------------------------------------------------- category --
  function renderCategory() {
    const cat = data.category;
    const list = data.videos;
    $('#crumb-current').textContent = cat.name;
    $('#category-title').textContent = cat.name;
    $('#category-desc').textContent = cat.description || '';
    $('#category-desc').hidden = !cat.description;
    $('#category-count').textContent = plural(list.length, 'video');
    categoryNav(cat.id);

    $('#empty-state').hidden = list.length > 0;
    if (!list.length) return;

    const grid = $('#video-grid');
    grid.className = 'vgrid';
    grid.dataset.orientation = cat.orientation;

    const syncUrl = (video, userAction) => {
      markActive(grid, video.id);
      if (userAction) history.replaceState(null, '', `${location.pathname}?v=${video.id}`);
    };
    const stage = createStage({ onChange: syncUrl });
    stage.setList(list);
    grid.replaceChildren(...list.map((v, i) => card(v, {
      showCategory: false,
      onPlay: () => { stage.state.userStarted = true; stage.show(i, { play: true, muted: false }); stage.scrollTo(); },
    })));
    $('#grid-head').hidden = false;
    $('#grid-title').textContent = `All ${cat.name}`;
    $('#grid-count').textContent = plural(list.length, 'video');

    const wanted = Number(new URLSearchParams(location.search).get('v')) || null;
    let idx = wanted ? list.findIndex((v) => v.id === wanted) : -1;
    if (idx < 0) idx = Math.max(0, list.findIndex((v) => v.featured));
    stage.show(idx, { play: Boolean(wanted && idx >= 0), muted: true });
    if (wanted && idx >= 0) setTimeout(() => stage.scrollTo(), 50);
  }

  // ------------------------------------------------------------ contact form --
  function initContact() {
    const form = $('#contact-form');
    if (!form) return;
    const status = $('#form-status');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.className = 'form-status';
      status.textContent = '';
      $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));

      const fd = new FormData(form);
      const payload = Object.fromEntries(['name', 'email', 'subject', 'message', 'website'].map((k) => [k, String(fd.get(k) || '')]));
      const invalid = [...form.elements].find((el) => el.willValidate && !el.checkValidity());
      if (invalid) {
        invalid.setAttribute('aria-invalid', 'true');
        invalid.focus();
        status.className = 'form-status err';
        status.textContent = invalid.name === 'message' ? 'Please write at least a short message (10+ characters).' : 'Please check the highlighted field.';
        return;
      }
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(body.error || 'Could not send your message.'), { field: body.field });
        form.reset();
        status.className = 'form-status ok';
        status.textContent = 'Thanks! Your message has been sent. I will get back to you soon.';
      } catch (err) {
        if (err.field && form.elements[err.field]) form.elements[err.field].setAttribute('aria-invalid', 'true');
        status.className = 'form-status err';
        status.textContent = err.message || 'Could not send your message. Please try again.';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send message';
      }
    });
  }

  // ------------------------------------------------------------------ chrome --
  function initChrome() {
    const header = $('.site-header');
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const toggle = $('.nav-toggle');
    const nav = $('#site-nav');
    const setOpen = (open) => {
      nav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.08 });
      $$('.section-head, .cat-section, .about-inner, .service, .contact-inner').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
    }
  }

  async function start() {
    if (!data || !data.settings) {
      if (page !== 'home') throw new Error('Missing page data');
      data = await fetch('/api/portfolio', { headers: { accept: 'application/json' } }).then((r) => r.json());
    }
    renderSettings(data.settings || {});
    if (page === 'home') renderHome();
    if (page === 'category') renderCategory();
    initContact();
    initChrome();
  }

  start().catch(() => {
    const empty = $('#empty-state');
    if (empty) empty.hidden = false;
  });
})();
