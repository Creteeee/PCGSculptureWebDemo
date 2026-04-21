export function isLikelyMobile() {
	const ua = navigator.userAgent || '';
	return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function getDefaultQualityProfile() {
	const mobile = isLikelyMobile();
	const dpr = window.devicePixelRatio || 1;

	return {
		isMobile: mobile,
		maxPixelRatio: mobile ? 1.25 : Math.min(2, dpr),
		interactionPixelRatio: 1,
		shadowsEnabled: mobile ? false : true,
		shadowMapSize: mobile ? 1024 : 2048,
		grass: {
			enabled: true,
			// keep a sane default ceiling
			count: mobile ? 800 : 1800,
			radius: mobile ? 7.5 : 10,
			crossBlades: mobile ? false : true,
			windStrength: mobile ? 0.14 : 0.18,
		},
		skybox: {
			enabled: true,
			background: true,
			environment: true,
			size: mobile ? 256 : 512,
		},
	};
}

/**
 * @param {import('three').WebGLRenderer} renderer
 * @param {{ maxPixelRatio: number }} profile
 */
export function applyBaseRendererQuality(renderer, profile) {
	renderer.setPixelRatio(Math.max(1, Math.min(window.devicePixelRatio || 1, profile.maxPixelRatio)));
}

/**
 * During interaction, temporarily reduce pixel ratio to cut fill-rate cost.
 *
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
 * @param {import('three').WebGLRenderer} renderer
 * @param {{ maxPixelRatio: number, interactionPixelRatio: number }} profile
 */
export function attachInteractionQualityGuard(controls, renderer, profile) {
	let restoreTimer = /** @type {number | null} */ (null);
	let isInteracting = false;

	function setInteraction(on) {
		if (on === isInteracting) return;
		isInteracting = on;
		const target = on ? profile.interactionPixelRatio : Math.min(profile.maxPixelRatio, window.devicePixelRatio || 1);
		renderer.setPixelRatio(Math.max(1, target));
	}

	function onStart() {
		if (restoreTimer) window.clearTimeout(restoreTimer);
		setInteraction(true);
	}

	function onEnd() {
		if (restoreTimer) window.clearTimeout(restoreTimer);
		restoreTimer = window.setTimeout(() => setInteraction(false), 140);
	}

	controls.addEventListener('start', onStart);
	controls.addEventListener('end', onEnd);

	return () => {
		if (restoreTimer) window.clearTimeout(restoreTimer);
		controls.removeEventListener('start', onStart);
		controls.removeEventListener('end', onEnd);
	};
}

