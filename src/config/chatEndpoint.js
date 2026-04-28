export const CHAT_ENDPOINT_BASE = 'https://1315142908-02gapylmzf.ap-guangzhou.tencentscf.com';

export function normalizeBaseUrl(endpoint) {
	let base = (endpoint || '').trim();
	if (!base) return '';
	base = base.replace(/\/+$/, '');
	return base;
}

