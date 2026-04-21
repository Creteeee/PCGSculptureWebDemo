const LS_ENDPOINT = 'pcg_chat_endpoint';
const LS_TOKEN = 'pcg_chat_token';
const IMAGEX_TEMPLATE = 'tplv-97hsy4j2xz-pcg存图';

function getEndpoint() {
	return window.localStorage.getItem(LS_ENDPOINT) || '';
}

function setEndpoint(v) {
	if (!v) return;
	window.localStorage.setItem(LS_ENDPOINT, v);
}

function getToken() {
	return window.localStorage.getItem(LS_TOKEN) || '';
}

function setToken(v) {
	window.localStorage.setItem(LS_TOKEN, v || '');
}

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function formatError(err) {
	if (err instanceof Error) return err.message;
	return String(err);
}

function normalizeBaseUrl(endpoint) {
	let base = (endpoint || '').trim();
	if (!base) return '';
	base = base.replace(/\/+$/, '');
	return base;
}

async function postJson(url, body, { token, signal } = {}) {
	const headers = {
		'Content-Type': 'application/json',
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const res = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
		signal,
	});

	if (!res.ok) {
		const txt = await res.text().catch(() => '');
		throw new Error(`请求失败：HTTP ${res.status} ${res.statusText}${txt ? `\n${txt}` : ''}`);
	}

	return await res.json();
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   getState?: () => any,
 *   getSystemPrompt?: () => Promise<string | null>,
 *   captureViewportBase64?: () => Promise<string>,
 *   applyStatePatch?: (patch: any) => void,
 *   onRenderSaved?: (item: { url: string, prompt?: string, createdAt: number }) => void,
 * }} [ctx]
 */
export function mountChatPanel(container, ctx = {}) {
	container.innerHTML = '';

	const root = el('div', 'chat');

	const header = el('div', 'chat__header');
	header.appendChild(el('div', 'chat__title', '对话模式'));

	const keyRow = el('div', 'chat__keyRow');
	const endpointInput = /** @type {HTMLInputElement} */ (el('input', 'chat__keyInput'));
	endpointInput.type = 'text';
	endpointInput.placeholder = '粘贴云函数 URL（例如 https://xxxx.ap-guangzhou.scf.tencentcs.com/）';
	endpointInput.value = getEndpoint();
	const saveEndpointBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '保存地址'));
	saveEndpointBtn.type = 'button';
	saveEndpointBtn.addEventListener('click', () => setEndpoint(endpointInput.value.trim()));
	keyRow.appendChild(endpointInput);
	keyRow.appendChild(saveEndpointBtn);

	const tokenRow = el('div', 'chat__keyRow');
	const tokenInput = /** @type {HTMLInputElement} */ (el('input', 'chat__keyInput'));
	tokenInput.type = 'password';
	tokenInput.placeholder = '可选：访问 token（建议配置，防止他人刷你的云函数）';
	tokenInput.value = getToken();
	const saveTokenBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn', '保存 token'));
	saveTokenBtn.type = 'button';
	saveTokenBtn.addEventListener('click', () => setToken(tokenInput.value.trim()));
	tokenRow.appendChild(tokenInput);
	tokenRow.appendChild(saveTokenBtn);

	header.appendChild(keyRow);
	header.appendChild(tokenRow);
	root.appendChild(header);

	const log = el('div', 'chat__log');
	root.appendChild(log);

	const composer = el('form', 'chat__composer');
	const input = /** @type {HTMLTextAreaElement} */ (el('textarea', 'chat__input'));
	input.placeholder = '输入内容，回车发送；Shift+Enter 换行';
	input.rows = 2;
	const sendBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn chat__send', '发送'));
	sendBtn.type = 'submit';
	composer.appendChild(input);
	composer.appendChild(sendBtn);
	root.appendChild(composer);

	container.appendChild(root);

	/** @type {{ role: 'system'|'user'|'assistant', content: string }[]} */
	const messages = [];

	function appendMsg(role, content) {
		const item = el('div', `chat__msg chat__msg--${role}`);
		const bubble = el('div', 'chat__bubble', content);
		item.appendChild(bubble);
		log.appendChild(item);
		log.scrollTop = log.scrollHeight;
	}

	let aborter = /** @type {AbortController | null} */ (null);

	async function onSend(text) {
		const base = normalizeBaseUrl(getEndpoint());
		if (!base) {
			appendMsg('assistant', '请先在上方粘贴并保存云函数 URL。');
			return;
		}
		const token = getToken();

		appendMsg('user', text);
		messages.push({ role: 'user', content: text });

		if (aborter) aborter.abort();
		aborter = new AbortController();

		sendBtn.disabled = true;
		try {
			const systemPrompt = ctx.getSystemPrompt ? await ctx.getSystemPrompt() : null;
			const state = ctx.getState ? ctx.getState() : null;

			const data = await postJson(
				`${base}/chat`,
				{
					messages,
					systemPrompt,
					state,
				},
				{ token, signal: aborter.signal },
			);

			const type = data?.type;
			const message = typeof data?.message === 'string' ? data.message : '';

			if (message) {
				messages.push({ role: 'assistant', content: message });
				appendMsg('assistant', message);
			}

			if (type === 'update_state' && data?.state_patch) {
				ctx.applyStatePatch?.(data.state_patch);
			} else if (type === 'render_image' && data?.render_request?.prompt) {
				const kind = data?.render_request?.kind || 'scene';
				if (kind === 'projection_texture') {
					appendMsg('assistant', '正在生成投影纹理…');
					const texResp = await postJson(
						`${base}/texture`,
						{
							render_request: data.render_request,
							imagex_template: IMAGEX_TEMPLATE,
						},
						{ token, signal: aborter.signal },
					);
					const url = texResp?.url || texResp?.data?.url;
					if (url) {
						ctx.applyStatePatch?.({ projection: { enabled: true, textureUrl: url } });
						appendMsg('assistant', '投影纹理已更新（不计入效果图历史）。');
					} else {
						appendMsg('assistant', '纹理生成完成，但未拿到 URL。');
					}
				} else {
					appendMsg('assistant', '正在生成效果图…');
					const viewportBase64 = ctx.captureViewportBase64 ? await ctx.captureViewportBase64() : '';

					const imgResp = await postJson(
						`${base}/image`,
						{
							render_request: data.render_request,
							state,
							viewport_image_base64: viewportBase64,
							imagex_template: IMAGEX_TEMPLATE,
						},
						{ token, signal: aborter.signal },
					);

					const url = imgResp?.url || imgResp?.data?.url;
					if (url) {
						const item = { url, prompt: data.render_request.prompt, createdAt: Date.now() };
						ctx.onRenderSaved?.(item);
						appendMsg('assistant', '效果图已生成并保存到历史列表。');
					} else {
						appendMsg('assistant', '生图完成，但未拿到图片 URL。');
					}
				}
			} else if (!message) {
				appendMsg('assistant', JSON.stringify(data));
			}
		} catch (err) {
			appendMsg('assistant', `出错了：${formatError(err)}`);
		} finally {
			sendBtn.disabled = false;
		}
	}

	composer.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text) return;
		input.value = '';
		onSend(text);
	});

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			composer.requestSubmit();
		}
	});

	return {
		dispose() {
			if (aborter) aborter.abort();
		},
	};
}

