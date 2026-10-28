(() => {
  'use strict';

  // ------------------------------------------------------------------ utils --
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** DOM builder. Text is always assigned via textContent (no innerHTML with data). */
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

  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const isSafeImage = (u) => typeof u === 'string' && (/^\/media\/images\/[a-f0-9]{32}\.[a-z]{3,4}$/.test(u) || u.startsWith('https://i.ytimg.com/'));
  const isSafeEmbed = (u) => typeof u === 'string' && ['https://www.youtube-nocookie.com/embed/', 'https://www.instagram.com/p/', 'https://www.tiktok.com/player/v1/', 'https://player.vimeo.com/video/'].some((p) => u.startsWith(p));
  const PLATFORM_LABEL = { youtube: 'YouTube', youtube_short: 'YouTube Shorts', instagram: 'Instagram', tiktok: 'TikTok', vimeo: 'Vimeo', upload: 'Uploaded file' };

  function toast(message, type = 'ok') {
    const t = h('div', { class: `toast ${type}`, role: type === 'err' ? 'alert' : 'status', text: message });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
  }

  // -------------------------------------------------------------------- api --
  let csrfToken = null;

  class ApiError extends Error {
    constructor(message, status, field) {
      super(message);
      this.status = status;
      this.field = field;
    }
  }

  async function api(method, path, body) {
    const headers = { accept: 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`/api/admin${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') {
      showLogin('Your session has ended. Please sign in again.');
      throw new ApiError('Please sign in.', 401);
    }
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.field);
    return data;
  }

  /** Multipart upload with progress (fetch has no upload progress events). */
  function upload(method, path, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, `/api/admin${path}`);
      xhr.setRequestHeader('x-csrf-token', csrfToken || '');
      xhr.setRequestHeader('accept', 'application/json');
      xhr.responseType = 'json';
      xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); });
      xhr.addEventListener('load', () => {
        const data = xhr.response || {};
        if (xhr.status === 401) { showLogin('Your session has ended. Please sign in again.'); return reject(new ApiError('Please sign in.', 401)); }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(data.error || (xhr.status === 413 ? 'File is too large.' : `Upload failed (${xhr.status})`), xhr.status, data.field));
      });
      xhr.addEventListener('error', () => reject(new ApiError('Network error during upload.', 0)));
      xhr.addEventListener('abort', () => reject(new ApiError('Upload cancelled.', 0)));
      xhr.send(formData);
      currentXhr = xhr;
    });
  }
  let currentXhr = null;

  // ------------------------------------------------------------------- auth --
  function showLogin(message = '') {
    csrfToken = null;
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    $$('dialog[open]').forEach((d) => d.close());
    $('#login-error').textContent = message;
    $('#login-form [name="password"]').value = '';
    $('#login-form [name="username"]').focus();
  }

  async function boot() {
    try {
      const res = await fetch('/api/admin/me', { headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return showLogin();
      const me = await res.json();
      csrfToken = me.csrfToken;
      $('#whoami').textContent = me.username;
      $('#login-view').hidden = true;
      $('#app-view').hidden = false;
      await loadShared();
      route();
    } catch {
      showLogin('Could not reach the server.');
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = $('button[type="submit"]', form);
    const err = $('#login-error');
    err.textContent = '';
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) { err.textContent = 'Enter your username and password.'; return; }
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await api('POST', '/login', { username, password });
      form.password.value = '';
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      form.password.value = '';
      form.password.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('POST', '/logout'); } catch { /* ignore */ }
    showLogin('You have been signed out.');
  });

  // ------------------------------------------------------------------ state --
  const store = { categories: [], videos: [], settings: null };

  async function loadShared() {
    const [c, v, s] = await Promise.all([api('GET', '/categories'), api('GET', '/videos'), api('GET', '/stats')]);
    store.categories = c.categories;
    store.videos = v.videos;
    updateUnread(s.unreadMessages);
  }

  function updateUnread(n) {
    const b = $('#unread-badge');
    b.textContent = String(n);
    b.hidden = !n;
  }

  // ----------------------------------------------------------------- router --
  // Hierarchy: Portfolio (categories) -> Category (its videos) -> Video editor.
  const VIEWS = {
    dashboard: { title: 'Dashboard', render: renderDashboard },
    portfolio: { title: 'Portfolio', render: renderPortfolio },
    videos: { title: 'All videos', render: renderVideos },
    settings: { title: 'Site content', render: renderSettings },
    messages: { title: 'Messages', render: renderMessages },
    account: { title: 'Account & security', render: renderAccount },
  };

  function currentRoute() {
    const [name, param] = location.hash.slice(1).split('/');
    return { name: name in VIEWS ? name : 'dashboard', param: param && /^\d{1,10}$/.test(param) ? Number(param) : null };
  }

  async function route() {
    if ($('#app-view').hidden) return;
    const { name, param } = currentRoute();
    const view = VIEWS[name];
    $$('.sidebar-nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
    $('#view-title').textContent = view.title;
    $('#topbar-actions').replaceChildren();
    const content = $('#content');
    content.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }));
    setSidebar(false);
    try {
      await view.render(content, param);
    } catch (err) {
      if (err.status !== 401) content.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'Something went wrong' }), h('p', { text: err.message })));
    }
  }
  window.addEventListener('hashchange', route);

  function setSidebar(open) {
    $('#sidebar').classList.toggle('open', open);
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  }
  $('#menu-btn').addEventListener('click', () => setSidebar(!$('#sidebar').classList.contains('open')));
  $$('.sidebar-nav .i').forEach((el) => {
    const name = { dashboard: 'home', portfolio: 'folder', videos: 'film', settings: 'sliders', messages: 'mail', account: 'user' }[el.parentElement.dataset.view];
    el.append(icon(name));
  });

  function addVideoButton(categoryId = null, label = 'Add video') {
    return h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openVideoEditor(null, { categoryId }) }, icon('plus'), label);
  }
  function newCategoryButton(primary = true) {
    return h('button', { class: `btn ${primary ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => openCategoryEditor() }, icon('plus'), 'New category');
  }
  const categoryName = (id) => store.categories.find((c) => c.id === id)?.name || 'Uncategorised';

  async function refreshStore() {
    const [c, v] = await Promise.all([api('GET', '/categories'), api('GET', '/videos')]);
    store.categories = c.categories;
    store.videos = v.videos;
  }

  // -------------------------------------------------------------- dashboard --
  async function renderDashboard(content) {
    const s = await api('GET', '/stats');
    await refreshStore();
    updateUnread(s.unreadMessages);
    $('#topbar-actions').append(addVideoButton());
    const stat = (n, label, href) => h('a', { class: 'stat', href }, h('b', { text: String(n) }), h('span', { text: label }));
    const recent = store.videos.slice(0, 5);
    content.replaceChildren(
      h('div', { class: 'stat-grid' },
        stat(s.categories, 'Categories', '#portfolio'), stat(s.videos, 'Total videos', '#videos'), stat(s.published, 'Published', '#videos'),
        stat(s.drafts, 'Drafts', '#videos'), stat(s.unreadMessages, 'Unread messages', '#messages')),
      h('div', { class: 'panel' },
        h('h2', { text: 'Your portfolio' }),
        h('p', { class: 'muted', text: 'Each category is a section on your website with its own page. Open a category to manage its videos.' }),
        store.categories.length
          ? h('div', { class: 'mini-cats' }, store.categories.map((c) => h('a', { class: 'mini-cat', href: `#portfolio/${c.id}` },
            h('strong', { text: c.name }), h('span', { class: 'muted small', text: `${c.videoCount} ${c.videoCount === 1 ? 'video' : 'videos'}` }))))
          : h('div', { class: 'empty-box' }, h('h3', { text: 'Create your first category' }), h('p', { text: 'For example: YouTube Videos, YouTube Shorts, Instagram Reels, TikTok.' }), newCategoryButton())),
      h('div', { class: 'panel' },
        h('h2', { text: 'Quick actions' }),
        h('div', { class: 'quick' },
          addVideoButton(),
          newCategoryButton(false),
          h('a', { class: 'btn btn-ghost', href: '#settings' }, 'Edit site content'),
          h('a', { class: 'btn btn-ghost', href: '/', target: '_blank', rel: 'noopener' }, 'Open website ↗'))),
      h('div', { class: 'panel' },
        h('h2', { text: 'Latest videos' }),
        h('p', { class: 'muted', text: recent.length ? 'The newest items across all categories.' : 'No videos yet.' }),
        recent.length ? h('div', { class: 'vlist' }, recent.map((v) => videoRow(v, { showCategory: true }))) : null),
    );
  }

  // -------------------------------------------------------------- portfolio --
  async function renderPortfolio(content, categoryId) {
    await refreshStore();
    if (categoryId) return renderCategoryDetail(content, categoryId);
    $('#topbar-actions').append(newCategoryButton());
    if (!store.categories.length) {
      content.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'No categories yet' }),
        h('p', { text: 'Categories are the sections of your portfolio (e.g. YouTube Videos, YouTube Shorts, Instagram Reels, TikTok). Every video lives inside a category.' }),
        newCategoryButton()));
      return;
    }
    const n = store.categories.length;
    content.replaceChildren(
      h('p', { class: 'muted small', text: 'Categories appear on the website in this order, each with its own page. Empty categories are hidden from visitors. Click a category to manage its videos.' }),
      h('div', { class: 'cat-cards' }, store.categories.map((c, i) => {
        const cover = h('a', { class: 'cat-cover', href: `#portfolio/${c.id}`, 'aria-label': `Open ${c.name}` });
        if (isSafeImage(c.cover)) cover.append(h('img', { src: c.cover, alt: '', loading: 'lazy' }));
        else cover.append(icon('folder'));
        const drafts = c.videoCount - c.publishedCount;
        return h('article', { class: 'cat-card' },
          cover,
          h('div', { class: 'cat-card-body' },
            h('a', { class: 'cat-card-title', href: `#portfolio/${c.id}`, text: c.name }),
            h('p', { class: 'muted small', text: `${c.videoCount} ${c.videoCount === 1 ? 'video' : 'videos'}${drafts ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''}` }),
            c.description ? h('p', { class: 'cat-card-desc', text: c.description }) : null),
          h('div', { class: 'cat-card-actions' },
            h('a', { class: 'btn btn-ghost btn-small', href: `#portfolio/${c.id}` }, 'Open'),
            h('span', { class: 'spacer' }),
            h('button', { class: 'icon-btn', type: 'button', title: 'Move left', 'aria-label': `Move ${c.name} earlier`, disabled: i === 0, onclick: () => moveCategory(i, -1) }, icon('up')),
            h('button', { class: 'icon-btn', type: 'button', title: 'Move right', 'aria-label': `Move ${c.name} later`, disabled: i === n - 1, onclick: () => moveCategory(i, 1) }, icon('down')),
            h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': `Edit ${c.name}`, onclick: () => openCategoryEditor(c) }, icon('edit')),
            h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': `Delete ${c.name}`, onclick: () => deleteCategory(c) }, icon('trash'))));
      })),
    );
  }

  function renderCategoryDetail(content, id) {
    const cat = store.categories.find((c) => c.id === id);
    if (!cat) {
      content.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'Category not found' }), h('a', { class: 'btn btn-ghost', href: '#portfolio' }, '← Back to portfolio')));
      return;
    }
    $('#view-title').textContent = cat.name;
    $('#topbar-actions').append(addVideoButton(cat.id, `Add video to ${cat.name}`));
    const videos = store.videos.filter((v) => v.categoryId === cat.id);
    const list = h('div', { class: 'vlist' });
    const search = h('input', { type: 'search', placeholder: `Search in ${cat.name}…`, 'aria-label': 'Search videos' });

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const filtered = q ? videos.filter((v) => `${v.title} ${v.client} ${v.tags.join(' ')}`.toLowerCase().includes(q)) : videos;
      if (!videos.length) {
        list.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: `No videos in ${cat.name} yet` }),
          h('p', { text: 'Paste a YouTube, Shorts, Instagram, TikTok or Vimeo link, or upload a video file.' }), addVideoButton(cat.id)));
        return;
      }
      if (!filtered.length) { list.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'No matches' }))); return; }
      const ordered = filtered.map((v) => v.id);
      list.replaceChildren(...filtered.map((v, i) => videoRow(v, { reorder: q ? null : { ids: ordered, index: i } })));
      if (!q) enableDrag(list);
    };
    search.addEventListener('input', draw);

    const drafts = cat.videoCount - cat.publishedCount;
    content.replaceChildren(
      h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#portfolio', text: 'Portfolio' }), h('span', { 'aria-hidden': 'true', text: '/' }), h('span', { text: cat.name })),
      h('div', { class: 'panel cat-detail' },
        h('div', {},
          h('h2', { text: cat.name }),
          h('p', { class: 'muted', text: cat.description || 'No description.' }),
          h('p', { class: 'small muted', text: `${cat.videoCount} ${cat.videoCount === 1 ? 'video' : 'videos'} · ${cat.publishedCount} published${drafts ? ` · ${drafts} draft${drafts === 1 ? '' : 's'}` : ''} · /category/${cat.slug}` })),
        h('div', { class: 'quick' },
          h('a', { class: 'btn btn-ghost btn-small', href: `/category/${cat.slug}`, target: '_blank', rel: 'noopener' }, 'View page ↗'),
          h('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => openCategoryEditor(cat) }, icon('edit'), 'Edit'),
          h('button', { class: 'btn btn-danger btn-small', type: 'button', onclick: () => deleteCategory(cat) }, icon('trash'), 'Delete category'))),
      h('div', { class: 'toolbar' }, search),
      h('p', { class: 'muted small', text: 'Drag rows (or use the arrows) to set the order on the website. The ★ featured video plays first on the category page.' }),
      list,
    );
    draw();
  }

  // ------------------------------------------------------------- all videos --
  const filters = { q: '', category: '', status: '' };

  function renderVideos(content) {
    $('#topbar-actions').append(addVideoButton());
    const search = h('input', { type: 'search', placeholder: 'Search titles, clients, tags…', value: filters.q, 'aria-label': 'Search videos' });
    const cat = h('select', { 'aria-label': 'Filter by category' },
      h('option', { value: '', text: 'All categories' }),
      store.categories.map((c) => h('option', { value: String(c.id), text: c.name })));
    cat.value = filters.category;
    const status = h('select', { 'aria-label': 'Filter by status' },
      h('option', { value: '', text: 'Any status' }), h('option', { value: 'published', text: 'Published' }), h('option', { value: 'draft', text: 'Drafts' }));
    status.value = filters.status;
    const list = h('div', { class: 'vlist' });

    const draw = () => {
      filters.q = search.value.trim().toLowerCase();
      filters.category = cat.value;
      filters.status = status.value;
      const filtered = store.videos.filter((v) => {
        if (filters.category && String(v.categoryId) !== filters.category) return false;
        if (filters.status === 'published' && !v.published) return false;
        if (filters.status === 'draft' && v.published) return false;
        if (filters.q && !`${v.title} ${v.client} ${v.tags.join(' ')} ${v.description}`.toLowerCase().includes(filters.q)) return false;
        return true;
      });
      if (!store.videos.length) {
        list.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'No videos yet' }),
          h('p', { text: 'Add YouTube videos, Shorts, Instagram Reels, TikToks, Vimeo links or upload your own files.' }), addVideoButton()));
        return;
      }
      if (!filtered.length) {
        list.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'No matches' }), h('p', { text: 'Try a different search or filter.' })));
        return;
      }
      list.replaceChildren(...filtered.map((v) => videoRow(v, { showCategory: true })));
    };
    search.addEventListener('input', draw);
    cat.addEventListener('change', draw);
    status.addEventListener('change', draw);
    content.replaceChildren(
      h('div', { class: 'toolbar' }, search, cat, status),
      h('p', { class: 'muted small', text: 'Every video across all categories. To change the order, open its category in Portfolio.' }),
      list,
    );
    draw();
  }

  function videoRow(v, { showCategory = false, reorder = null } = {}) {
    const thumb = h('div', { class: 'vthumb' });
    if (isSafeImage(v.thumbnail)) thumb.append(h('img', { src: v.thumbnail, alt: '', loading: 'lazy' }));
    else thumb.append(icon('film'));
    thumb.append(h('span', { class: 'orient', text: { landscape: '16:9', portrait: '9:16', square: '1:1' }[v.orientation] }));

    const row = h('div', { class: 'vrow', dataset: { id: v.id } },
      h('span', { class: 'drag', title: reorder ? 'Drag to reorder' : '', 'aria-hidden': 'true' }, reorder ? icon('grip') : null),
      thumb,
      h('div', { class: 'vinfo' },
        h('div', { class: 'vtitle', text: v.title }),
        h('div', { class: 'vmeta' },
          h('span', { class: `p-${v.platform}`, text: PLATFORM_LABEL[v.platform] }),
          showCategory ? h('a', { href: `#portfolio/${v.categoryId}`, class: 'cat-link', text: categoryName(v.categoryId) }) : null,
          v.client ? h('span', { text: v.client }) : null,
          h('span', { class: `tag ${v.published ? 'live' : 'draft'}`, text: v.published ? 'Published' : 'Draft' }),
          v.featured ? h('span', { class: 'tag feat', text: 'Featured' }) : null)),
      h('div', { class: 'vactions' },
        reorder ? h('button', { class: 'icon-btn', type: 'button', title: 'Move up', 'aria-label': `Move ${v.title} up`, disabled: reorder.index === 0, onclick: () => moveVideo(reorder.ids, reorder.index, -1) }, icon('up')) : null,
        reorder ? h('button', { class: 'icon-btn', type: 'button', title: 'Move down', 'aria-label': `Move ${v.title} down`, disabled: reorder.index === reorder.ids.length - 1, onclick: () => moveVideo(reorder.ids, reorder.index, 1) }, icon('down')) : null,
        h('button', { class: `icon-btn${v.featured ? ' on' : ''}`, type: 'button', title: v.featured ? 'Unfeature' : 'Feature (play first in its category)', 'aria-pressed': String(v.featured), 'aria-label': 'Toggle featured', onclick: () => quickToggle(v, 'featured') }, icon('star')),
        h('button', { class: 'icon-btn', type: 'button', title: v.published ? 'Unpublish (hide)' : 'Publish', 'aria-label': v.published ? 'Unpublish' : 'Publish', onclick: () => quickToggle(v, 'published') }, icon(v.published ? 'eye' : 'eyeOff')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': `Edit ${v.title}`, onclick: () => openVideoEditor(v) }, icon('edit')),
        h('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': `Delete ${v.title}`, onclick: () => deleteVideo(v) }, icon('trash'))));
    if (reorder) row.draggable = true;
    return row;
  }

  async function quickToggle(v, field) {
    try {
      await api('PATCH', `/videos/${v.id}`, { [field]: !v[field] });
      toast(field === 'published' ? (v.published ? 'Video hidden from the website.' : 'Video published.') : (v.featured ? 'Removed from featured.' : 'Marked as featured.'));
      route();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function deleteVideo(v) {
    const ok = await confirmDialog('Delete this video?', `“${v.title}” will be removed from ${categoryName(v.categoryId)}${v.platform === 'upload' ? ' and the uploaded file will be deleted' : ''}. This cannot be undone.`);
    if (!ok) return;
    try {
      await api('DELETE', `/videos/${v.id}`);
      toast('Video deleted.');
      route();
    } catch (err) { toast(err.message, 'err'); }
  }

  async function saveOrder(ids) {
    try {
      await api('POST', '/videos/reorder', { ids });
      toast('Order saved.');
    } catch (err) { toast(err.message, 'err'); }
    route();
  }

  function moveVideo(ids, index, delta) {
    const next = ids.slice();
    const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    saveOrder(next);
  }

  function enableDrag(list) {
    let dragged = null;
    list.addEventListener('dragstart', (e) => {
      dragged = e.target.closest('.vrow');
      if (!dragged) return;
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragged.dataset.id);
    });
    list.addEventListener('dragover', (e) => {
      const over = e.target.closest('.vrow');
      if (!dragged || !over || over === dragged) return;
      e.preventDefault();
      const after = e.clientY > over.getBoundingClientRect().top + over.offsetHeight / 2;
      $$('.drop-before, .drop-after', list).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
      over.classList.add(after ? 'drop-after' : 'drop-before');
    });
    list.addEventListener('drop', (e) => {
      const over = e.target.closest('.vrow');
      if (!dragged || !over || over === dragged) return;
      e.preventDefault();
      const after = over.classList.contains('drop-after');
      over.classList.remove('drop-before', 'drop-after');
      if (after) over.after(dragged); else over.before(dragged);
      saveOrder($$('.vrow', list).map((r) => Number(r.dataset.id)));
    });
    list.addEventListener('dragend', () => {
      if (dragged) dragged.classList.remove('dragging');
      $$('.drop-before, .drop-after', list).forEach((el) => el.classList.remove('drop-before', 'drop-after'));
      dragged = null;
    });
  }

  // ------------------------------------------------------------ video editor --
  const vd = $('#video-dialog');
  const vf = $('#video-form');
  const editor = { video: null, parsed: null, localUrl: null, autoThumb: null, customThumbUrl: null, removeThumb: false, parseTimer: null, parseSeq: 0 };

  function sourceType() { return vf.sourceType.value; }

  function setSourceType(type) {
    vf.querySelector(`[name="sourceType"][value="${type}"]`).checked = true;
    $('#pane-link').hidden = type !== 'link';
    $('#pane-upload').hidden = type !== 'upload';
    renderPreview();
    renderThumb();
  }
  $$('[name="sourceType"]', vf).forEach((r) => r.addEventListener('change', () => setSourceType(sourceType())));

  function openVideoEditor(video = null, { categoryId = null } = {}) {
    if (!store.categories.length) {
      toast('Create a category first — every video belongs to a category.', 'err');
      openCategoryEditor();
      return;
    }
    editor.video = video;
    editor.parsed = null;
    editor.removeThumb = false;
    cleanupLocal();
    vf.reset();
    $('#video-error').textContent = '';
    $('#parse-status').textContent = '';
    $('#parse-status').className = 'parse-status';
    $('#upload-progress').hidden = true;
    $('#dz-sub').textContent = 'MP4, MOV or WebM';
    $$('[aria-invalid]', vf).forEach((el) => el.removeAttribute('aria-invalid'));
    $('#video-dialog-title').textContent = video ? 'Edit video' : 'Add video';
    $('#video-submit').textContent = video ? 'Save changes' : 'Add to portfolio';

    const sel = $('#video-category');
    sel.replaceChildren(...store.categories.map((c) => h('option', { value: String(c.id), text: c.name })));

    if (video) {
      vf.title.value = video.title;
      vf.description.value = video.description;
      vf.client.value = video.client;
      vf.tags.value = video.tags.join(', ');
      sel.value = video.categoryId ? String(video.categoryId) : String(store.categories[0].id);
      vf.orientation.value = video.orientation;
      vf.published.checked = video.published;
      vf.featured.checked = video.featured;
      if (video.platform === 'upload') {
        $('#dz-sub').textContent = 'Current file kept unless you choose a new one.';
      } else {
        vf.url.value = video.sourceUrl || '';
        editor.parsed = { platform: video.platform, embedUrl: video.embedUrl, thumbnail: video.platform.startsWith('youtube') ? video.thumbnail : null, orientation: video.orientation };
      }
      setSourceType(video.platform === 'upload' ? 'upload' : 'link');
    } else {
      // Pre-select the category the admin is working in.
      const pre = categoryId || currentRoute().param || Number(filters.category) || null;
      if (pre && store.categories.some((c) => c.id === pre)) sel.value = String(pre);
      setSourceType('link');
    }
    vd.showModal();
    (video ? vf.title : vf.url).focus();
  }

  function cleanupLocal() {
    if (editor.localUrl) URL.revokeObjectURL(editor.localUrl);
    if (editor.customThumbUrl) URL.revokeObjectURL(editor.customThumbUrl);
    editor.localUrl = null;
    editor.customThumbUrl = null;
    editor.autoThumb = null;
  }

  function closeVideoEditor() {
    if (currentXhr && currentXhr.readyState !== 4) currentXhr.abort();
    $('#video-preview').replaceChildren();
    cleanupLocal();
    vd.close();
  }
  $$('[data-close]', vd).forEach((b) => b.addEventListener('click', closeVideoEditor));
  vd.addEventListener('cancel', (e) => { e.preventDefault(); closeVideoEditor(); });

  // Live link parsing
  vf.url.addEventListener('input', () => {
    clearTimeout(editor.parseTimer);
    const value = vf.url.value.trim();
    const status = $('#parse-status');
    if (!value) { editor.parsed = null; status.textContent = ''; renderPreview(); renderThumb(); return; }
    status.className = 'parse-status';
    status.textContent = 'Checking link…';
    editor.parseTimer = setTimeout(async () => {
      const seq = ++editor.parseSeq;
      try {
        const parsed = await api('POST', '/parse-url', { url: value });
        if (seq !== editor.parseSeq) return;
        editor.parsed = parsed;
        status.className = 'parse-status ok';
        status.textContent = `✓ ${parsed.platformLabel} video detected (${parsed.orientation === 'portrait' ? 'vertical' : parsed.orientation}).`;
        vf.url.removeAttribute('aria-invalid');
      } catch (err) {
        if (seq !== editor.parseSeq) return;
        editor.parsed = null;
        status.className = 'parse-status err';
        status.textContent = err.message;
      }
      renderPreview();
      renderThumb();
    }, 400);
  });

  function renderPreview() {
    const box = $('#video-preview');
    box.className = 'preview';
    box.replaceChildren();
    if (sourceType() === 'upload') {
      const src = editor.localUrl || (editor.video && editor.video.platform === 'upload' ? editor.video.videoUrl : null);
      if (!src) { box.append(h('span', { class: 'muted', text: 'Choose a video file to preview it here.' })); return; }
      const orient = vf.orientation.value || editor.detectedOrientation || editor.video?.orientation;
      if (orient === 'portrait') box.classList.add('portrait');
      box.append(h('video', { src, controls: true, playsinline: true, muted: true, preload: 'metadata' }));
      return;
    }
    const p = editor.parsed;
    if (!p || !isSafeEmbed(p.embedUrl)) { box.append(h('span', { class: 'muted', text: 'Paste a link to preview it here.' })); return; }
    if (p.orientation === 'portrait' || p.platform === 'tiktok') box.classList.add('portrait');
    if (p.platform === 'instagram') box.classList.add('instagram');
    box.append(h('iframe', {
      src: p.embedUrl, title: 'Video preview', loading: 'lazy', allow: 'encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox',
    }));
  }

  function renderThumb() {
    const box = $('#thumb-preview');
    const reset = $('#thumb-reset');
    const hint = $('#thumb-hint');
    box.replaceChildren();
    let src = null;
    let custom = false;
    if (editor.customThumbUrl) { src = editor.customThumbUrl; custom = true; }
    else if (!editor.removeThumb && editor.video?.hasCustomThumbnail && isSafeImage(editor.video.thumbnail)) { src = editor.video.thumbnail; custom = true; }
    else if (sourceType() === 'upload' && editor.autoThumb) src = URL.createObjectURL(editor.autoThumb);
    else if (sourceType() === 'link' && editor.parsed?.thumbnail && isSafeImage(editor.parsed.thumbnail)) src = editor.parsed.thumbnail;

    if (src) box.append(h('img', { src, alt: 'Thumbnail preview' }));
    else box.append(h('span', { class: 'muted small', text: 'Automatic' }));
    reset.hidden = !custom;

    const p = sourceType() === 'upload' ? 'upload' : editor.parsed?.platform;
    hint.textContent = {
      upload: 'A frame from your video is used automatically. Upload an image to use a custom cover.',
      youtube: 'YouTube thumbnail is used automatically.',
      youtube_short: 'YouTube thumbnail is used automatically.',
      tiktok: 'The TikTok cover is fetched automatically when possible. Upload an image to be sure.',
      vimeo: 'The Vimeo thumbnail is fetched automatically when possible.',
      instagram: 'Instagram does not share thumbnails — upload a cover image for the best look.',
    }[p] || 'Upload a JPG, PNG or WebP cover image (optional).';
  }

  vf.thumbnail.addEventListener('change', () => {
    const file = vf.thumbnail.files[0];
    if (editor.customThumbUrl) URL.revokeObjectURL(editor.customThumbUrl);
    editor.customThumbUrl = file ? URL.createObjectURL(file) : null;
    editor.removeThumb = false;
    renderThumb();
  });
  $('#thumb-reset').addEventListener('click', () => {
    vf.thumbnail.value = '';
    if (editor.customThumbUrl) URL.revokeObjectURL(editor.customThumbUrl);
    editor.customThumbUrl = null;
    editor.removeThumb = true;
    renderThumb();
  });
  vf.orientation.addEventListener('change', renderPreview);

  // Local video selection: preview, detect orientation and grab a frame for the thumbnail.
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.add('over')));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('over')));
  vf.video.addEventListener('change', () => {
    const file = vf.video.files[0];
    if (editor.localUrl) URL.revokeObjectURL(editor.localUrl);
    editor.localUrl = null;
    editor.autoThumb = null;
    editor.detectedOrientation = null;
    if (!file) { $('#dz-sub').textContent = 'MP4, MOV or WebM'; renderPreview(); renderThumb(); return; }
    $('#dz-sub').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    if (!vf.title.value) vf.title.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 150);
    editor.localUrl = URL.createObjectURL(file);
    renderPreview();
    analyseVideo(editor.localUrl);
  });

  function analyseVideo(url) {
    const probe = document.createElement('video');
    probe.muted = true;
    probe.preload = 'auto';
    probe.playsInline = true;
    probe.src = url;
    probe.addEventListener('loadedmetadata', () => {
      const { videoWidth: w, videoHeight: hgt } = probe;
      if (w && hgt) {
        const r = w / hgt;
        editor.detectedOrientation = r < 0.9 ? 'portrait' : r > 1.1 ? 'landscape' : 'square';
        renderPreview();
      }
      probe.currentTime = Math.min(1, (probe.duration || 2) / 3);
    }, { once: true });
    probe.addEventListener('seeked', () => {
      try {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(probe.videoWidth, probe.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(probe.videoWidth * scale);
        canvas.height = Math.round(probe.videoHeight * scale);
        canvas.getContext('2d').drawImage(probe, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob && editor.localUrl === url) { editor.autoThumb = blob; renderThumb(); }
          probe.removeAttribute('src');
          probe.load();
        }, 'image/jpeg', 0.85);
      } catch { /* codec not decodable in this browser — server will still accept the file */ }
    }, { once: true });
  }

  vf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#video-error');
    err.textContent = '';
    $$('[aria-invalid]', vf).forEach((el) => el.removeAttribute('aria-invalid'));
    const type = sourceType();
    const isEdit = Boolean(editor.video);

    if (!vf.categoryId.value) { vf.categoryId.setAttribute('aria-invalid', 'true'); err.textContent = 'Choose a category.'; return; }
    if (!vf.title.value.trim()) { vf.title.setAttribute('aria-invalid', 'true'); vf.title.focus(); err.textContent = 'Give the video a title.'; return; }
    if (type === 'link' && !vf.url.value.trim()) { vf.url.setAttribute('aria-invalid', 'true'); vf.url.focus(); err.textContent = 'Paste a video link.'; return; }
    if (type === 'upload' && !vf.video.files[0] && !(isEdit && editor.video.platform === 'upload')) { err.textContent = 'Choose a video file to upload.'; return; }

    const fd = new FormData();
    fd.append('sourceType', type);
    for (const k of ['title', 'description', 'client', 'tags', 'categoryId']) fd.append(k, vf[k].value);
    fd.append('orientation', vf.orientation.value || (type === 'upload' ? editor.detectedOrientation || '' : ''));
    fd.append('published', vf.published.checked ? '1' : '0');
    fd.append('featured', vf.featured.checked ? '1' : '0');
    if (type === 'link') fd.append('url', vf.url.value.trim());
    if (editor.removeThumb) fd.append('removeThumbnail', '1');
    // Text fields must come before files so the server can validate them first.
    if (type === 'upload' && vf.video.files[0]) fd.append('video', vf.video.files[0]);
    if (vf.thumbnail.files[0]) fd.append('thumbnail', vf.thumbnail.files[0]);
    else if (type === 'upload' && vf.video.files[0] && editor.autoThumb) fd.append('thumbnail', editor.autoThumb, 'frame.jpg');

    const btn = $('#video-submit');
    btn.disabled = true;
    const hasFile = fd.has('video');
    $('#upload-progress').hidden = !hasFile;
    const setPct = (p) => { $('#upload-bar').style.width = `${Math.round(p * 100)}%`; $('#upload-pct').textContent = p >= 1 ? 'Processing…' : `${Math.round(p * 100)}%`; };
    setPct(0);
    btn.textContent = hasFile ? 'Uploading…' : 'Saving…';
    try {
      await upload(isEdit ? 'PUT' : 'POST', isEdit ? `/videos/${editor.video.id}` : '/videos', fd, setPct);
      toast(isEdit ? 'Video updated.' : 'Video added to your portfolio.');
      closeVideoEditor();
      route();
    } catch (ex) {
      if (ex.status === 401) return;
      err.textContent = ex.message;
      if (ex.field && vf[ex.field]) { vf[ex.field].setAttribute?.('aria-invalid', 'true'); }
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? 'Save changes' : 'Add to portfolio';
      $('#upload-progress').hidden = true;
    }
  });

  // ------------------------------------------------------------- categories --
  async function moveCategory(i, delta) {
    const ids = store.categories.map((c) => c.id);
    const j = i + delta;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await api('POST', '/categories/reorder', { ids }); } catch (err) { toast(err.message, 'err'); }
    route();
  }

  // Deleting a category that has videos: move them elsewhere or delete them too.
  const dd = $('#delete-category-dialog');
  const df = $('#delete-category-form');
  let deleting = null;
  $$('[data-close]', dd).forEach((b) => b.addEventListener('click', () => dd.close()));
  $$('[name="mode"]', df).forEach((r) => r.addEventListener('change', () => { df.target.disabled = df.mode.value !== 'move'; }));

  async function deleteCategory(c) {
    if (!c.videoCount) {
      if (!(await confirmDialog(`Delete “${c.name}”?`, 'This category is empty. It will be removed from your website.'))) return;
      return performCategoryDelete(c, '');
    }
    deleting = c;
    $('#delete-category-title').textContent = `Delete “${c.name}”?`;
    $('#delete-category-text').textContent = `This category contains ${c.videoCount} ${c.videoCount === 1 ? 'video' : 'videos'}. What should happen to ${c.videoCount === 1 ? 'it' : 'them'}?`;
    $('#delete-category-error').textContent = '';
    const others = store.categories.filter((x) => x.id !== c.id);
    df.target.replaceChildren(...others.map((x) => h('option', { value: String(x.id), text: x.name })));
    const moveRadio = df.querySelector('[name="mode"][value="move"]');
    moveRadio.disabled = !others.length;
    df.querySelector(`[name="mode"][value="${others.length ? 'move' : 'delete'}"]`).checked = true;
    df.target.disabled = !others.length;
    $('#delete-category-count').textContent = `${c.videoCount}`;
    dd.showModal();
  }

  df.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!deleting) return;
    const mode = df.mode.value;
    const query = mode === 'move' ? `?videos=move&to=${encodeURIComponent(df.target.value)}` : '?videos=delete';
    if (mode === 'delete' && !(await confirmDialog('Delete the videos too?', `${deleting.videoCount} video(s) and their uploaded files will be permanently deleted.`))) return;
    try {
      await performCategoryDelete(deleting, query);
      dd.close();
    } catch (err) { $('#delete-category-error').textContent = err.message; }
  });

  async function performCategoryDelete(c, query) {
    const res = await api('DELETE', `/categories/${c.id}${query}`);
    toast(res.moved ? `Category deleted. ${res.moved} video(s) moved.` : res.deleted ? `Category and ${res.deleted} video(s) deleted.` : 'Category deleted.');
    if (currentRoute().param === c.id) location.hash = '#portfolio';
    else route();
  }

  const cd = $('#category-dialog');
  const cf = $('#category-form');
  let editingCategory = null;
  function openCategoryEditor(c = null) {
    editingCategory = c;
    cf.reset();
    $('#category-error').textContent = '';
    $('#category-dialog-title').textContent = c ? 'Edit category' : 'New category';
    if (c) { cf.name.value = c.name; cf.description.value = c.description; }
    cd.showModal();
    cf.name.focus();
  }
  $$('[data-close]', cd).forEach((b) => b.addEventListener('click', () => cd.close()));
  cf.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { name: cf.name.value.trim(), description: cf.description.value.trim() };
    if (!body.name) { $('#category-error').textContent = 'Name is required.'; cf.name.focus(); return; }
    try {
      const res = editingCategory
        ? await api('PUT', `/categories/${editingCategory.id}`, body)
        : await api('POST', '/categories', body);
      cd.close();
      toast(editingCategory ? 'Category updated.' : 'Category created. Now add videos to it.');
      if (!editingCategory) location.hash = `#portfolio/${res.category.id}`;
      else route();
    } catch (err) { $('#category-error').textContent = err.message; }
  });

  // --------------------------------------------------------------- settings --
  const SETTINGS_SECTIONS = [
    { title: 'Profile', desc: 'Your name and role appear in the header, title and footer.', fields: [
      ['site_name', 'Your name / brand', 'text', 80], ['role_title', 'Role', 'text', 80, 'Video Editor'],
      ['location', 'Location', 'text', 80, 'e.g. Lahore, Pakistan · Remote'], ['availability', 'Availability badge', 'text', 80, 'Leave empty to hide'],
    ], avatar: true },
    { title: 'Hero', desc: 'The first thing visitors read.', fields: [
      ['hero_heading', 'Headline', 'text', 140], ['hero_subheading', 'Intro paragraph', 'textarea', 400],
    ] },
    { title: 'Showreel & highlights', desc: 'The showreel plays first in the “All work” view.', showreel: true, fields: [
      ['stat_1_value', 'Stat 1 value', 'text', 20], ['stat_1_label', 'Stat 1 label', 'text', 40],
      ['stat_2_value', 'Stat 2 value', 'text', 20], ['stat_2_label', 'Stat 2 label', 'text', 40],
      ['stat_3_value', 'Stat 3 value', 'text', 20], ['stat_3_label', 'Stat 3 label', 'text', 40],
      ['stat_4_value', 'Stat 4 value', 'text', 20], ['stat_4_label', 'Stat 4 label', 'text', 40],
    ] },
    { title: 'About', desc: 'Separate paragraphs with an empty line.', fields: [
      ['about_heading', 'Heading', 'text', 140], ['about_text', 'About text', 'textarea', 4000],
      ['skills', 'Skills (comma separated)', 'text', 600], ['software', 'Software (comma separated)', 'text', 400],
    ] },
    { title: 'Services', desc: 'One service per line in the format: Title | Short description. Leave empty to hide the section.', fields: [
      ['services', 'Services', 'textarea', 3000],
    ] },
    { title: 'Contact', desc: 'Messages from the contact form arrive in the Messages inbox.', fields: [
      ['contact_heading', 'Heading', 'text', 140], ['contact_text', 'Text', 'textarea', 600],
      ['contact_email', 'Public email', 'email', 254, 'you@example.com'], ['booking_url', 'Booking link (Calendly etc.)', 'url', 300, 'https://'],
    ] },
    { title: 'Social links', desc: 'Full https:// links. Leave empty to hide.', fields: [
      ['social_youtube', 'YouTube', 'url', 300, 'https://youtube.com/@…'], ['social_instagram', 'Instagram', 'url', 300, 'https://instagram.com/…'],
      ['social_tiktok', 'TikTok', 'url', 300, 'https://tiktok.com/@…'], ['social_linkedin', 'LinkedIn', 'url', 300, 'https://linkedin.com/in/…'],
      ['social_x', 'X / Twitter', 'url', 300, 'https://x.com/…'], ['social_behance', 'Behance', 'url', 300, 'https://behance.net/…'],
      ['social_vimeo', 'Vimeo', 'url', 300, 'https://vimeo.com/…'],
    ] },
    { title: 'Appearance & SEO', desc: '', fields: [
      ['accent_color', 'Accent colour', 'color', 7], ['seo_description', 'Search engine description', 'textarea', 300],
      ['footer_text', 'Footer note', 'text', 200],
    ] },
  ];

  async function renderSettings(content) {
    const { settings } = await api('GET', '/settings');
    store.settings = settings;
    const form = h('form', { class: 'settings-form', novalidate: true });
    for (const sec of SETTINGS_SECTIONS) {
      const panel = h('div', { class: 'panel' }, h('h2', { text: sec.title }), sec.desc ? h('p', { class: 'muted', text: sec.desc }) : null);
      if (sec.avatar) panel.append(avatarControl(settings));
      if (sec.showreel) {
        const sel = h('select', { name: 'showreel_video_id' }, h('option', { value: '', text: '— None (use the first featured video) —' }),
          store.videos.map((v) => h('option', { value: String(v.id), text: `${v.title} · ${PLATFORM_LABEL[v.platform]}${v.published ? '' : ' (draft)'}` })));
        sel.value = settings.showreel_video_id || '';
        panel.append(h('label', { class: 'field' }, h('span', { text: 'Showreel video' }), sel));
      }
      const grid = h('div', { class: 'field-grid' });
      for (const [key, label, type, max, placeholder] of sec.fields) {
        let input;
        if (type === 'textarea') input = h('textarea', { name: key, maxlength: max, rows: key === 'about_text' || key === 'services' ? 7 : 3 });
        else input = h('input', { name: key, type, maxlength: type === 'color' ? null : max, placeholder: placeholder || null, autocomplete: 'off' });
        input.value = settings[key] ?? '';
        grid.append(h('label', { class: `field${type === 'textarea' ? ' span-2' : ''}` }, h('span', { text: label }), input));
      }
      panel.append(grid);
      form.append(panel);
    }
    const err = h('p', { class: 'form-error', role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit', text: 'Save changes' });
    form.append(h('div', { class: 'settings-actions' }, save, h('a', { class: 'btn btn-ghost', href: '/', target: '_blank', rel: 'noopener', text: 'Preview website ↗' }), err));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
      const body = {};
      $$('input[name], textarea[name], select[name]', form).forEach((el) => { body[el.name] = el.value; });
      save.disabled = true;
      try {
        await api('PUT', '/settings', body);
        toast('Site content saved.');
      } catch (ex) {
        err.textContent = ex.message;
        const f = ex.field && form.elements[ex.field];
        if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
      } finally { save.disabled = false; }
    });
    content.replaceChildren(form);
  }

  function avatarControl(settings) {
    const box = h('div', { class: 'avatar' });
    const draw = (s) => {
      box.replaceChildren(isSafeImage(s.avatar) ? h('img', { src: s.avatar, alt: 'Profile photo' }) : icon('user'));
      remove.hidden = !s.avatar;
    };
    const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    const remove = h('button', { class: 'btn btn-text btn-small', type: 'button', text: 'Remove' });
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('avatar', file);
      try {
        const res = await upload('POST', '/settings/avatar', fd, () => {});
        draw(res.settings);
        toast('Photo updated.');
      } catch (ex) { toast(ex.message, 'err'); }
      input.value = '';
    });
    remove.addEventListener('click', async () => {
      try { draw((await api('DELETE', '/settings/avatar')).settings); toast('Photo removed.'); } catch (ex) { toast(ex.message, 'err'); }
    });
    draw(settings);
    return h('div', { class: 'field' }, h('span', { text: 'Profile photo (About section)' }),
      h('div', { class: 'avatar-row' }, box, h('label', { class: 'btn btn-ghost btn-small file-btn' }, 'Upload photo', input), remove));
  }

  // --------------------------------------------------------------- messages --
  async function renderMessages(content) {
    const { messages } = await api('GET', '/messages');
    updateUnread(messages.filter((m) => !m.read).length);
    if (!messages.length) {
      content.replaceChildren(h('div', { class: 'empty-box' }, h('h3', { text: 'No messages yet' }), h('p', { text: 'Messages sent through the contact form on your website will appear here.' })));
      return;
    }
    content.replaceChildren(h('div', { class: 'mlist' }, messages.map((m) => {
      const d = h('details', { class: `msg${m.read ? '' : ' unread'}` },
        h('summary', {},
          h('span', { class: 'unread-dot', 'aria-hidden': 'true' }),
          h('div', { class: 'msg-head' }, h('strong', { text: `${m.name} · ${m.subject || 'New enquiry'}` }), h('span', { text: `${m.email} · ${fmtDate(m.createdAt)}` })),
          h('span', { class: 'muted small', text: m.read ? 'Read' : 'New' })),
        h('div', { class: 'msg-body' },
          h('pre', { text: m.body }),
          h('div', { class: 'msg-actions' },
            h('a', { class: 'btn btn-primary btn-small', href: `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject || 'Your enquiry'}`)}`, text: 'Reply by email' }),
            h('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Mark as unread', onclick: async () => { await api('PATCH', `/messages/${m.id}`, { read: false }); route(); } }),
            h('button', { class: 'btn btn-danger btn-small', type: 'button', text: 'Delete', onclick: async () => {
              if (!(await confirmDialog('Delete this message?', 'This cannot be undone.'))) return;
              await api('DELETE', `/messages/${m.id}`);
              toast('Message deleted.');
              route();
            } }))));
      d.addEventListener('toggle', async () => {
        if (d.open && !m.read) {
          m.read = true;
          d.classList.remove('unread');
          try { await api('PATCH', `/messages/${m.id}`, { read: true }); } catch { /* ignore */ }
          updateUnread($$('.msg.unread').length);
        }
      });
      return d;
    })));
  }

  // ---------------------------------------------------------------- account --
  function renderAccount(content) {
    const form = h('form', { novalidate: true },
      h('label', { class: 'field' }, h('span', { text: 'Current password' }), h('input', { name: 'currentPassword', type: 'password', autocomplete: 'current-password', maxlength: 256, required: true })),
      h('label', { class: 'field' }, h('span', { text: 'New password' }), h('input', { name: 'newPassword', type: 'password', autocomplete: 'new-password', minlength: 12, maxlength: 256, required: true }),
        h('small', { class: 'hint', text: 'At least 12 characters using three of: lowercase, uppercase, numbers, symbols.' })),
      h('label', { class: 'field' }, h('span', { text: 'Repeat new password' }), h('input', { name: 'confirm', type: 'password', autocomplete: 'new-password', maxlength: 256, required: true })),
      h('p', { class: 'form-error', role: 'alert' }),
      h('button', { class: 'btn btn-primary', type: 'submit', text: 'Change password' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      if (form.newPassword.value !== form.confirm.value) { err.textContent = 'The new passwords do not match.'; return; }
      try {
        await api('POST', '/password', { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value });
        form.reset();
        // The server issued a fresh session; fetch its new CSRF token.
        const me = await api('GET', '/me');
        csrfToken = me.csrfToken;
        toast('Password changed. Other devices were signed out.');
      } catch (ex) { err.textContent = ex.message; }
    });
    content.replaceChildren(
      h('div', { class: 'panel' }, h('h2', { text: 'Change password' }), h('p', { class: 'muted', text: 'Changing your password signs you out everywhere else.' }), form),
      h('div', { class: 'panel' }, h('h2', { text: 'Sessions' }), h('p', { class: 'muted', text: 'Signed in on a shared or lost device? End all other sessions.' }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Sign out all other devices', onclick: async () => {
          try { await api('POST', '/logout-others'); toast('All other sessions ended.'); } catch (ex) { toast(ex.message, 'err'); }
        } })),
    );
  }

  // ---------------------------------------------------------------- confirm --
  function confirmDialog(title, text) {
    const d = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    d.returnValue = 'cancel';
    d.showModal();
    return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
  }

  boot();
})();
