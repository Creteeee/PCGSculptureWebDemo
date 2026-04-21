/**
 * 从 public/config/defaultState.json 读取默认参数。
 * 若文件不存在或读取失败，返回 null（继续使用代码内置默认值）。
 */
export async function loadDefaultState() {
	const base = import.meta.env.BASE_URL || '/';
	const url = `${base}config/defaultState.json`;

	try {
		const res = await fetch(url, { cache: 'no-cache' });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

export function deepMerge(target, source) {
	if (!source || typeof source !== 'object') return target;
	for (const key of Object.keys(source)) {
		const sv = source[key];
		if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
			if (!target[key] || typeof target[key] !== 'object') target[key] = {};
			deepMerge(target[key], sv);
		} else {
			target[key] = sv;
		}
	}
	return target;
}

