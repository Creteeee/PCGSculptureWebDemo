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

  const lbInner = el('div', 'lightbox__inner');
  const lbImg = /** @type {HTMLImageElement} */ (el('img', 'lightbox__img'));
  const lbMeta = el('div', 'lightbox__meta');
  const lbPrompt = el('div', 'lightbox__prompt');
  const lbTime = el('div', 'lightbox__time');
  const lbActions = el('div', 'lightbox__actions');
  const lbOpen = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '新窗口打开'));
  const lbCopy = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '复制链接'));
  const lbClose = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '关闭'));

  lbOpen.type = 'button';
  lbCopy.type = 'button';
  lbClose.type = 'button';

  lbActions.appendChild(lbOpen);
  lbActions.appendChild(lbCopy);
  lbActions.appendChild(lbClose);
  lbMeta.appendChild(lbPrompt);
  lbMeta.appendChild(lbTime);
  lbMeta.appendChild(lbActions);

  lbInner.appendChild(lbImg);
  lbInner.appendChild(lbMeta);
  lightbox.appendChild(lbInner);
  const header = el('div', 'gallery__header');
  header.appendChild(el('div', 'gallery__title', '效果图（历史）'));

  const migrateBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '迁移到火山(稳定链接)'));
  migrateBtn.type = 'button';
  migrateBtn.addEventListener('click', async () => {
    const items = loadRenderHistory();
    if (!items.length) return;

    const endpoint = (window.localStorage.getItem('pcg_chat_endpoint') || '').trim().replace(/\/+$/, '');
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

  /** @type {{ url: string, prompt?: string, createdAt?: number } | null} */
  let opened = null;

  function openLightbox(it) {
    if (!it?.url) return;
    opened = it;
    lbImg.src = it.url;
    lbImg.alt = it.prompt || 'render';
    lbPrompt.textContent = it.prompt || '(无提示词)';
    lbTime.textContent = new Date(it.createdAt || Date.now()).toLocaleString();
    lightbox.classList.add('lightbox--open');
    lightbox.setAttribute('aria-hidden', 'false');
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

      actions.appendChild(openBtn);
      actions.appendChild(copyBtn);
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

