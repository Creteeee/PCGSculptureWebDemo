import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

let hdriApplyToken = 0;
let cachedHdri = /** @type {Map<string, { hdr: THREE.Texture, env: THREE.Texture }>} */ (new Map());

function resolveUrl(urlLike) {
	const base = import.meta.env.BASE_URL || '/';
	const s = String(urlLike || '').trim();
	if (!s) return '';
	if (/^https?:\/\//i.test(s)) return s;
	return `${base}${s.replace(/^\/+/, '')}`;
}

function createFaceCanvas(size, topColor, bottomColor, noiseStrength = 0.03) {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;

	const ctx = canvas.getContext('2d');
	const grad = ctx.createLinearGradient(0, 0, 0, size);
	grad.addColorStop(0, topColor);
	grad.addColorStop(1, bottomColor);
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, size, size);

	// subtle dithering/noise to reduce banding
	if (noiseStrength > 0) {
		const img = ctx.getImageData(0, 0, size, size);
		const data = img.data;
		for (let i = 0; i < data.length; i += 4) {
			const n = (Math.random() * 2 - 1) * 255 * noiseStrength;
			data[i] = Math.max(0, Math.min(255, data[i] + n));
			data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
			data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
		}
		ctx.putImageData(img, 0, 0);
	}

	return canvas;
}

export function createProceduralSkyCubeTexture({
	size = 512,
	topColor = '#5aa7ff',
	bottomColor = '#e9f5ff',
} = {}) {
	// 6 faces: px, nx, py, ny, pz, nz
	const faces = [
		createFaceCanvas(size, topColor, bottomColor),
		createFaceCanvas(size, topColor, bottomColor),
		createFaceCanvas(size, topColor, bottomColor),
		// down face: still use the same ramp but with less noise
		createFaceCanvas(size, bottomColor, bottomColor, 0.02),
		createFaceCanvas(size, topColor, bottomColor),
		createFaceCanvas(size, topColor, bottomColor),
	];

	const tex = new THREE.CubeTexture(faces);
	tex.needsUpdate = true;
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.mapping = THREE.CubeReflectionMapping;
	return tex;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {{
 *   enabled?: boolean,
 *   background?: boolean,
 *   environment?: boolean,
 *   intensity?: number,
 *   size?: number,
 * }} [options]
 */
export function applySkybox(renderer, scene, options = {}) {
	const {
		enabled = true,
		background = true,
		environment = true,
		intensity = 1,
		hdriUrl = '',
		size = 512,
		topColor = '#5aa7ff',
		bottomColor = '#e9f5ff',
	} = options;

	if (!enabled) {
		if (scene.background && scene.background.isTexture) scene.background.dispose?.();
		scene.background = null;
		scene.environment = null;
		return { cube: null, env: null };
	}

	const token = ++hdriApplyToken;
	const url = resolveUrl(hdriUrl);

	// Fallback (procedural) while HDRI is absent or loading
	let cube = null;
	let env = null;

	if (!url) {
		cube = createProceduralSkyCubeTexture({ size, topColor, bottomColor });
		if (background) scene.background = cube;
		if (environment) {
			const pmrem = new THREE.PMREMGenerator(renderer);
			env = pmrem.fromCubemap(cube).texture;
			pmrem.dispose();
			scene.environment = env;
		}
	} else {
		// Best-effort: use cache immediately if present
		const cached = cachedHdri.get(url);
		if (cached) {
			if (background) scene.background = cached.env;
			if (environment) scene.environment = cached.env;
			env = cached.env;
		} else {
			// Kick off async load; leave existing scene background/environment untouched for now
			const loader = new EXRLoader();
			loader.load(
				url,
				(hdrTex) => {
					// If user changed settings before load finished, ignore stale result
					if (token !== hdriApplyToken) {
						hdrTex.dispose?.();
						return;
					}

					hdrTex.mapping = THREE.EquirectangularReflectionMapping;
					hdrTex.colorSpace = THREE.LinearSRGBColorSpace;

					const pmrem = new THREE.PMREMGenerator(renderer);
					const envTex = pmrem.fromEquirectangular(hdrTex).texture;
					pmrem.dispose();

					cachedHdri.set(url, { hdr: hdrTex, env: envTex });

					if (background) scene.background = envTex;
					if (environment) scene.environment = envTex;
				},
				undefined,
				() => {
					// If HDRI fails to load, silently fall back to procedural in the next sync
				},
			);
		}
	}

	// material envMapIntensity is applied per-material; keep a global hint for custom shaders
	scene.userData.environmentIntensity = intensity;

	return { cube, env };
}

