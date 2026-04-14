import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { createRng } from './seededRandom.js';
import { createPerlin3D } from './perlin3d.js';
import { createVoronoi3D } from './voronoi3d.js';

/** @typedef {'perlin' | 'simplex' | 'voronoi'} NoiseType */

let simplexInstance = null;
let simplexSeed = NaN;
let perlinInstance = null;
let perlinSeed = NaN;
let voronoiInstance = null;
let voronoiSeed = NaN;

function fract(x) {
	return x - Math.floor(x);
}

/**
 * tiling：对采样坐标做周期折叠，使噪声在 [0,1)^3 上重复（可能出现接缝）。
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} tiling
 */
function applyTiling(x, y, z, tiling) {
	if (tiling <= 0) return { x, y, z };
	return {
		x: fract(x * tiling) * 2 - 1,
		y: fract(y * tiling) * 2 - 1,
		z: fract(z * tiling) * 2 - 1,
	};
}

function clamp01(t) {
	return Math.min(1, Math.max(0, t));
}

function getSimplex(seed) {
	if (simplexInstance == null || simplexSeed !== seed) {
		const rng = createRng(seed);
		simplexInstance = new SimplexNoise({ random: () => rng() });
		simplexSeed = seed;
	}
	return simplexInstance;
}

function getPerlin(seed) {
	if (perlinInstance == null || perlinSeed !== seed) {
		perlinInstance = createPerlin3D(seed);
		perlinSeed = seed;
	}
	return perlinInstance;
}

function getVoronoi(seed) {
	if (voronoiInstance == null || voronoiSeed !== seed) {
		voronoiInstance = createVoronoi3D(seed);
		voronoiSeed = seed;
	}
	return voronoiInstance;
}

/**
 * @param {NoiseType} type
 * @param {number} ux单位球方向 x
 * @param {number} uy
 * @param {number} uz
 * @param {{ frequency: number, tiling: number, seed: number }} opts
 * @returns {number} 约 [-1, 1]
 */
export function sampleNoise(type, ux, uy, uz, opts) {
	const { frequency, tiling, seed } = opts;
	let x = ux * frequency;
	let y = uy * frequency;
	let z = uz * frequency;
	const o = seed * 0.1031;
	x += o;
	y += o * 1.013;
	z += o * 1.017;
	// UI 的 tiling 范围为 0..1：内部映射到 0.5..4 周期数
	const tiles = 0.5 + clamp01(tiling) * 3.5;
	const t = applyTiling(x, y, z, tiles);
	x = t.x;
	y = t.y;
	z = t.z;

	switch (type) {
	case 'simplex':
		return getSimplex(seed).noise3d(x, y, z);
	case 'perlin':
		return getPerlin(seed)(x, y, z);
	case 'voronoi':
		return getVoronoi(seed)(x, y, z);
	default:
		return getSimplex(seed).noise3d(x, y, z);
	}
}
