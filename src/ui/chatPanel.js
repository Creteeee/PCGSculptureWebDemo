const IMAGEX_TEMPLATE = 'tplv-97hsy4j2xz-pcg存图';

import { CHAT_ENDPOINT_BASE, normalizeBaseUrl } from '../config/chatEndpoint.js';

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

async function postJson(url, body, { signal } = {}) {
	const headers = {
		'Content-Type': 'application/json',
	};

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
	const headerRow = el('div', 'chat__headerRow');
	headerRow.appendChild(el('div', 'chat__title', '对话模式'));

	const switcher = el('div', 'chatMode');
	const btnText = /** @type {HTMLButtonElement} */ (el('button', 'chatMode__btn', '打字模式'));
	const btnVoice = /** @type {HTMLButtonElement} */ (el('button', 'chatMode__btn', '语音模式'));
	btnText.type = 'button';
	btnVoice.type = 'button';
	btnText.setAttribute('aria-selected', 'true');
	btnVoice.setAttribute('aria-selected', 'false');
	switcher.appendChild(btnText);
	switcher.appendChild(btnVoice);
	headerRow.appendChild(switcher);

	header.appendChild(headerRow);
	root.appendChild(header);

	const voiceBar = el('div', 'voiceBar');
	const voiceBtn = /** @type {HTMLButtonElement} */ (el('button', 'chat__btn voiceBar__btn', '点击开始录音'));
	voiceBtn.type = 'button';
	const voicePreview = /** @type {HTMLTextAreaElement} */ (el('textarea', 'chat__input voiceBar__preview'));
	voicePreview.placeholder = '语音识别文本会出现在这里（停止录音后将自动发送）';
	voicePreview.rows = 2;
	voicePreview.readOnly = true;
	voiceBar.appendChild(voiceBtn);
	voiceBar.appendChild(voicePreview);
	root.appendChild(voiceBar);

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

	function beginDraftUserBubble() {
		const item = el('div', 'chat__msg chat__msg--user');
		const bubble = el('div', 'chat__bubble chat__bubble--draft', '');
		item.appendChild(bubble);
		log.appendChild(item);
		log.scrollTop = log.scrollHeight;
		return { item, bubble };
	}

	let aborter = /** @type {AbortController | null} */ (null);
	let mode = /** @type {'text'|'voice'} */ ('text');
	let recordingActive = false; // user toggled on
	let recognizing = false;
	let recog = null;
	let draft = /** @type {{ item: HTMLElement, bubble: HTMLElement } | null} */ (null);
	let lastSpokenDraft = '';
	let manualStopping = false;

	function setMode(next) {
		mode = next;
		btnText.setAttribute('aria-selected', String(mode === 'text'));
		btnVoice.setAttribute('aria-selected', String(mode === 'voice'));
		voiceBar.style.display = mode === 'voice' ? 'grid' : 'none';
		composer.style.display = mode === 'text' ? 'grid' : 'none';
	}

	btnText.addEventListener('click', () => setMode('text'));
	btnVoice.addEventListener('click', () => setMode('voice'));
	setMode('text');

	function getSpeechRecognition() {
		const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!SR) return null;
		const r = new SR();
		r.lang = 'zh-CN';
		r.interimResults = true;
		r.continuous = true;
		r.maxAlternatives = 1;
		return r;
	}

	async function stopRecognition() {
		manualStopping = true;
		try {
			recog?.stop?.();
		} catch {
			// ignore
		}
		recordingActive = false;
		recognizing = false;
		voiceBtn.textContent = '点击开始录音';
		voiceBtn.classList.remove('voiceBar__btn--on');

		const finalText = String(voicePreview.value || '').trim();
		if (finalText) {
			voicePreview.value = '';
			// finalize draft bubble if present
			if (draft) {
				draft.bubble.textContent = finalText;
				draft.bubble.classList.remove('chat__bubble--draft');
				draft = null;
			}
			await onSend(finalText);
		} else {
			// remove empty draft bubble
			if (draft) {
				draft.item.remove();
				draft = null;
			}
		}
		recog = null;
		lastSpokenDraft = '';
		manualStopping = false;
	}

	async function startRecognition() {
		if (recordingActive || recognizing) return;
		recordingActive = true;
		manualStopping = false;
		// Pre-warm mic permission/device (Edge reliability)
		try {
			if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
				throw Object.assign(new Error('Not secure context'), { name: 'SecurityError' });
			}
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const t of stream.getTracks()) t.stop();
		} catch {
			recordingActive = false;
			const err = arguments[0];
			const name = err?.name || '';
			const msg = err?.message || '';
			let hint = '无法获取麦克风。';
			if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
				hint =
					'麦克风权限被拒绝。请在浏览器地址栏左侧站点设置中允许麦克风，并刷新页面后再试。';
			} else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
				hint = '未检测到麦克风设备。请检查系统是否有可用输入设备。';
			} else if (name === 'NotReadableError' || name === 'TrackStartError') {
				hint =
					'麦克风被占用或设备忙。请关闭其它正在使用麦克风的标签页/软件（如微信、QQ、录屏、会议软件）后再试。';
			} else if (name === 'SecurityError') {
				hint = '当前页面不是安全环境（需要 HTTPS 或 localhost）。';
			}
			try {
				// eslint-disable-next-line no-console
				console.error('getUserMedia failed:', err);
			} catch {
				// ignore
			}
			appendMsg('assistant', `${hint}${name || msg ? `\n（${name}${msg ? `: ${msg}` : ''}）` : ''}`);
			return;
		}
		const r = getSpeechRecognition();
		if (!r) {
			recordingActive = false;
			appendMsg('assistant', '当前浏览器不支持语音识别（SpeechRecognition）。建议使用最新版 Chrome/Edge。');
			return;
		}
		recog = r;
		voicePreview.value = '';
		recognizing = true;
		voiceBtn.textContent = '点击停止录音';
		voiceBtn.classList.add('voiceBar__btn--on');
		draft = beginDraftUserBubble();
		lastSpokenDraft = '';

		r.onresult = (e) => {
			let finalized = '';
			let interim = '';
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const res = e.results[i];
				const s = res?.[0]?.transcript || '';
				if (res?.isFinal) finalized += s;
				else interim += s;
			}
			finalized = finalized.trim();
			let base = `${lastSpokenDraft}`.trimEnd();
			if (finalized) {
				base = base ? `${base} ${finalized}` : finalized;
				lastSpokenDraft = `${base}`;
			}
			const bubbleText = `${base} ${interim}`.trim();
			voicePreview.value = bubbleText;
			if (draft) {
				draft.bubble.textContent = bubbleText || '（正在识别…）';
				log.scrollTop = log.scrollHeight;
			}
		};
		r.onerror = () => {
			// Do not auto-submit; just stop the session and let user retry.
			recognizing = false;
			recog = null;
			voiceBtn.textContent = '点击开始录音';
			voiceBtn.classList.remove('voiceBar__btn--on');
			recordingActive = false;
			appendMsg('assistant', '语音识别中断，请再点一次开始录音。');
			if (draft && !String(voicePreview.value || '').trim()) {
				draft.item.remove();
				draft = null;
			}
		};
		r.onend = () => {
			// Edge may end automatically; do NOT auto-submit.
			recognizing = false;
			recog = null;
			if (manualStopping) return;
			voiceBtn.textContent = '点击开始录音';
			voiceBtn.classList.remove('voiceBar__btn--on');
			recordingActive = false;
		};
		try {
			r.start();
		} catch {
			recordingActive = false;
			recognizing = false;
			recog = null;
			voiceBtn.textContent = '点击开始录音';
			voiceBtn.classList.remove('voiceBar__btn--on');
			appendMsg('assistant', '语音识别启动失败，请重试。');
		}
	}

	voiceBtn.addEventListener('click', async () => {
		if (!recognizing) await startRecognition();
		else await stopRecognition();
	});

	async function onSend(text) {
		const base = normalizeBaseUrl(CHAT_ENDPOINT_BASE);
		if (!base) {
			appendMsg('assistant', '云函数地址未配置。');
			return;
		}

		// In voice mode we already showed a draft bubble; avoid duplicating.
		if (mode !== 'voice') appendMsg('user', text);
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
				{ signal: aborter.signal },
			);

			const type = data?.type;
			const message = typeof data?.message === 'string' ? data.message : '';
			const posterPrompt = typeof data?.poster_prompt === 'string' ? data.poster_prompt : '';
			const tweet = typeof data?.tweet === 'string' ? data.tweet : '';

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
						{ signal: aborter.signal },
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
						{ signal: aborter.signal },
					);

					const url = imgResp?.url || imgResp?.data?.url;
					if (url) {
						const item = {
							url,
							prompt: data.render_request.prompt,
							createdAt: Date.now(),
							kind,
							posterPrompt: posterPrompt || (kind === 'poster' ? data.render_request.prompt : ''),
							tweet: tweet || '',
						};
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
			try {
				recog?.stop?.();
			} catch {
				// ignore
			}
		},
	};
}

