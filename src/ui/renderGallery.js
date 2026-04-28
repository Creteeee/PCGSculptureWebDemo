import { CHAT_ENDPOINT_BASE, normalizeBaseUrl } from '../config/chatEndpoint.js';
const LS_KEY = 'pcg_render_history_v1';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export function loadRenderHistory() {
  const raw = window.localStorage.getItem(LS_KEY);
  const data = safeJsonParse(raw || '[]', []);
  return Array.isArray(data) ? data : [];
}

export function saveRenderHistory(items) {
  window.localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, 50)));
}

export function pushRenderHistory(item) {
  const items = loadRenderHistory();
  items.unshift(item);
  saveRenderHistory(items);
  return items;
}

export function mountRenderGallery(container, { onClear } = {}) {
  container.innerHTML = '';

  const root = el('div', 'gallery');
  const lightbox = el('div', 'lightbox');
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-hidden', 'true');
  lightbox.tabIndex = -1;

  const lbInner = el('div', 'lightbox__inner lightbox__inner--split');
  const lbMedia = el('div', 'lightbox__media');
  const lbImg = /** @type {HTMLImageElement} */ (el('img', 'lightbox__img'));

  const lbSide = el('div', 'lightbox__side');
  const tabs = el('div', 'sideTabs');
  const tabInfo = /** @type {HTMLButtonElement} */ (el('button', '', '信息'));
  const tabPoster = /** @type {HTMLButtonElement} */ (el('button', '', '海报&推文'));
  tabInfo.type = 'button';
  tabPoster.type = 'button';
  tabInfo.setAttribute('aria-selected', 'true');
  tabPoster.setAttribute('aria-selected', 'false');
  tabs.appendChild(tabInfo);
  tabs.appendChild(tabPoster);

  const panelInfo = el('div', 'sidePanel sidePanel--open');
  const panelPoster = el('div', 'sidePanel');

  const infoWrap = el('div', 'kv');
  const infoPromptLabel = el('div', 'kv__label', '提示词');
  const infoPrompt = el('div', 'kv__value');
  const infoTimeLabel = el('div', 'kv__label', '时间');
  const infoTime = el('div', 'kv__value');
  const infoActions = el('div', 'kv__row');

  const posterWrap = el('div', 'kv');
  const posterHint = el(
    'div',
    'kv__label',
    '在对话里说“生成海报/推文/小红书文案”，系统会基于室内艺术馆效果图生成海报指令与推文内容。',
  );
  const posterPromptLabel = el('div', 'kv__label', '海报生图指令（含排版与字号）');
  const posterPrompt = el('div', 'kv__value');
  const posterPromptActions = el('div', 'kv__row');
  const tweetLabel = el('div', 'kv__label', '推文/小红书文案（含标题与 emoji）');
  const tweet = el('div', 'kv__value');
  const tweetActions = el('div', 'kv__row');

  const lbOpen = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '新窗口打开'));
  const lbCopy = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '复制链接'));
  const lbClose = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '关闭'));
  const copyPosterPromptBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '复制海报指令'));
  const copyTweetBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '复制推文'));

  lbOpen.type = 'button';
  lbCopy.type = 'button';
  lbClose.type = 'button';
  copyPosterPromptBtn.type = 'button';
  copyTweetBtn.type = 'button';

  infoActions.appendChild(lbOpen);
  infoActions.appendChild(lbCopy);
  infoActions.appendChild(lbClose);

  infoWrap.appendChild(infoPromptLabel);
  infoWrap.appendChild(infoPrompt);
  infoWrap.appendChild(infoTimeLabel);
  infoWrap.appendChild(infoTime);
  infoWrap.appendChild(infoActions);
  panelInfo.appendChild(infoWrap);

  posterPromptActions.appendChild(copyPosterPromptBtn);
  tweetActions.appendChild(copyTweetBtn);
  posterWrap.appendChild(posterHint);
  posterWrap.appendChild(posterPromptLabel);
  posterWrap.appendChild(posterPrompt);
  posterWrap.appendChild(posterPromptActions);
  posterWrap.appendChild(tweetLabel);
  posterWrap.appendChild(tweet);
  posterWrap.appendChild(tweetActions);
  panelPoster.appendChild(posterWrap);

  lbSide.appendChild(tabs);
  lbSide.appendChild(panelInfo);
  lbSide.appendChild(panelPoster);

  lbMedia.appendChild(lbImg);
  lbInner.appendChild(lbMedia);
  lbInner.appendChild(lbSide);
  lightbox.appendChild(lbInner);
  const header = el('div', 'gallery__header');
  header.appendChild(el('div', 'gallery__title', '效果图（历史）'));

  const migrateBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '迁移到火山(稳定链接)'));
  migrateBtn.type = 'button';
  migrateBtn.addEventListener('click', async () => {
    const items = loadRenderHistory();
    if (!items.length) return;

    const endpoint = normalizeBaseUrl(CHAT_ENDPOINT_BASE);
    const token = window.localStorage.getItem('pcg_chat_token') || '';
    if (!endpoint) {
      migrateBtn.textContent = '请先配置云函数地址';
      window.setTimeout(() => (migrateBtn.textContent = '迁移到火山(稳定链接)'), 1200);
      return;
    }

    migrateBtn.disabled = true;
    migrateBtn.textContent = '迁移中…';
    try {
      const urls = items.map((it) => it.url).filter(Boolean);
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetch(`${endpoint}/migrate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls, tpl: 'tplv-97hsy4j2xz-pcg存图' }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();

      const map = new Map();
      for (const r of data?.results || []) {
        if (r?.ok && r.src && r.url) map.set(r.src, r.url);
      }

      const next = items.map((it) => {
        const nu = map.get(it.url);
        return nu ? { ...it, url: nu } : it;
      });
      saveRenderHistory(next);
      renderList(next);
      migrateBtn.textContent = '迁移完成';
      window.setTimeout(() => (migrateBtn.textContent = '迁移到火山(稳定链接)'), 1200);
    } catch {
      migrateBtn.textContent = '迁移失败';
      window.setTimeout(() => (migrateBtn.textContent = '迁移到火山(稳定链接)'), 1200);
    } finally {
      migrateBtn.disabled = false;
    }
  });

  const clearBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '清空历史'));
  clearBtn.type = 'button';
  clearBtn.addEventListener('click', () => {
    saveRenderHistory([]);
    renderList([]);
    onClear?.();
  });
  header.appendChild(migrateBtn);
  header.appendChild(clearBtn);
  root.appendChild(header);

  const list = el('div', 'gallery__list');
  root.appendChild(list);

  const hint = el('div', 'gallery__hint', '在对话中触发“生成效果图”后，这里会出现历史记录。');
  root.appendChild(hint);

  container.appendChild(root);
  container.appendChild(lightbox);

  /** @type {{ url: string, prompt?: string, createdAt?: number, posterPrompt?: string, tweet?: string, kind?: string } | null} */
  let opened = null;

  function setTab(which) {
    const isInfo = which === 'info';
    tabInfo.setAttribute('aria-selected', String(isInfo));
    tabPoster.setAttribute('aria-selected', String(!isInfo));
    panelInfo.classList.toggle('sidePanel--open', isInfo);
    panelPoster.classList.toggle('sidePanel--open', !isInfo);
  }

  tabInfo.addEventListener('click', () => setTab('info'));
  tabPoster.addEventListener('click', () => setTab('poster'));

  function openLightbox(it) {
    if (!it?.url) return;
    opened = it;
    lbImg.src = it.url;
    lbImg.alt = it.prompt || 'render';
    infoPrompt.textContent = it.prompt || '(无提示词)';
    infoTime.textContent = new Date(it.createdAt || Date.now()).toLocaleString();
    posterPrompt.textContent = it.posterPrompt || '(暂无：请在对话中请求生成海报)';
    tweet.textContent = it.tweet || '(暂无：请在对话中请求生成推文/小红书文案)';
    lightbox.classList.add('lightbox--open');
    lightbox.setAttribute('aria-hidden', 'false');
    setTab(it.posterPrompt || it.tweet ? 'poster' : 'info');
    // focus for ESC
    try {
      lightbox.focus();
    } catch {
      // ignore
    }
  }

  function closeLightbox() {
    opened = null;
    lightbox.classList.remove('lightbox--open');
    lightbox.setAttribute('aria-hidden', 'true');
    lbImg.src = '';
    posterPrompt.textContent = '';
    tweet.textContent = '';
  }

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lbClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  lbOpen.addEventListener('click', () => {
    if (!opened?.url) return;
    window.open(opened.url, '_blank', 'noopener,noreferrer');
  });
  lbCopy.addEventListener('click', async () => {
    if (!opened?.url) return;
    try {
      await navigator.clipboard.writeText(opened.url);
      lbCopy.textContent = '已复制';
      window.setTimeout(() => (lbCopy.textContent = '复制链接'), 900);
    } catch {
      // ignore
    }
  });

  copyPosterPromptBtn.addEventListener('click', async () => {
    if (!opened?.posterPrompt) return;
    try {
      await navigator.clipboard.writeText(opened.posterPrompt);
      copyPosterPromptBtn.textContent = '已复制';
      window.setTimeout(() => (copyPosterPromptBtn.textContent = '复制海报指令'), 900);
    } catch {
      // ignore
    }
  });

  copyTweetBtn.addEventListener('click', async () => {
    if (!opened?.tweet) return;
    try {
      await navigator.clipboard.writeText(opened.tweet);
      copyTweetBtn.textContent = '已复制';
      window.setTimeout(() => (copyTweetBtn.textContent = '复制推文'), 900);
    } catch {
      // ignore
    }
  });

  function renderList(items) {
    list.innerHTML = '';
    if (!items.length) {
      list.appendChild(el('div', 'gallery__empty', '暂无记录'));
      return;
    }

    for (const it of items) {
      const card = el('div', 'gallery__card');
      const img = /** @type {HTMLImageElement} */ (el('img', 'gallery__img'));
      img.loading = 'lazy';
      img.alt = it.prompt || 'render';
      img.src = it.url;
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => openLightbox(it));
      card.appendChild(img);

      const meta = el('div', 'gallery__meta');
      meta.appendChild(el('div', 'gallery__prompt', it.prompt || '(无提示词)'));
      meta.appendChild(el('div', 'gallery__time', new Date(it.createdAt || Date.now()).toLocaleString()));

      const actions = el('div', 'gallery__actions');
      const openBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '打开'));
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => window.open(it.url, '_blank', 'noopener,noreferrer'));

      const copyBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '复制链接'));
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(it.url);
          copyBtn.textContent = '已复制';
          window.setTimeout(() => (copyBtn.textContent = '复制链接'), 900);
        } catch {
          // ignore
        }
      });

      const posterBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '海报&推文'));
      posterBtn.type = 'button';
      posterBtn.addEventListener('click', () => {
        openLightbox(it);
        setTab('poster');
      });

      actions.appendChild(openBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(posterBtn);
      meta.appendChild(actions);

      card.appendChild(meta);
      list.appendChild(card);
    }
  }

  renderList(loadRenderHistory());

  return {
    refresh() {
      renderList(loadRenderHistory());
    },
  };
}

