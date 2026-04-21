import * as THREE from 'three';

/**
 * 灯光与阴影配置。projectionHooks 供后续投影纹样等功能注册回调。
 *
 * @param {THREE.Scene} scene
 * @param {{ hooks: Array<(ctx: LightingContext) => void> }} [extension]
 */
export function createLightingRig(scene, extension = { hooks: [] }) {
	const ambient = new THREE.AmbientLight(0xffffff, 0.35);
	scene.add(ambient);

	const directional = new THREE.DirectionalLight(0xffffff, 1.25);
	directional.position.set(6, 10, 4);
	directional.castShadow = true;
	directional.shadow.mapSize.set(2048, 2048);
	directional.shadow.camera.near = 0.5;
	directional.shadow.camera.far = 80;
	directional.shadow.camera.left = -14;
	directional.shadow.camera.right = 14;
	directional.shadow.camera.top = 14;
	directional.shadow.camera.bottom = -14;
	directional.shadow.bias = -0.00025;
	scene.add(directional);
	scene.add(directional.target);

	/** @type {LightingContext} */
	const ctx = {
		scene,
		ambient,
		directional,
		extension: {
			/** @type {Array<(c: LightingContext) => void>} */
			projectionHooks: extension.hooks,
			/**
			 * 注册投影纹样等扩展（每帧或参数变更时可由外部调用 hooks）。
			 * @param {(c: LightingContext) => void} fn
			 */
			registerProjectionHook(fn) {
				extension.hooks.push(fn);
			},
		},
	};

	return ctx;
}

/**
 * @typedef {object} LightingContext
 * @property {THREE.Scene} scene
 * @property {THREE.AmbientLight} ambient
 * @property {THREE.DirectionalLight} directional
 * @property {object} extension
 * @property {Array<(c: LightingContext) => void>} extension.projectionHooks
 * @property {(fn: (c: LightingContext) => void) => void} extension.registerProjectionHook
 */

/**
 * @param {LightingContext} ctx
 * @param {{ intensity: number }} a
 * @param {{ intensity: number, x: number, y: number, z: number, shadowMapSize?: number }} dir
 * @param {boolean} shadowsEnabled
 */
export function applyLightingParams(ctx, a, dir, shadowsEnabled) {
	ctx.ambient.intensity = a.intensity;
	ctx.directional.intensity = dir.intensity;
	ctx.directional.position.set(dir.x, dir.y, dir.z);
	ctx.directional.target.position.set(0, 0, 0);
	ctx.directional.castShadow = shadowsEnabled;
	if (typeof dir.shadowMapSize === 'number' && Number.isFinite(dir.shadowMapSize)) {
		const size = Math.max(128, Math.min(4096, Math.floor(dir.shadowMapSize)));
		if (ctx.directional.shadow.mapSize.x !== size || ctx.directional.shadow.mapSize.y !== size) {
			ctx.directional.shadow.mapSize.set(size, size);
			ctx.directional.shadow.needsUpdate = true;
		}
	}
}
