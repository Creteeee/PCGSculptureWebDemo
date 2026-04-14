import { createRng } from './seededRandom.js';

function fract(x) {
	return x - Math.floor(x);
}

/**
 * 3D Worley / Voronoi：返回到最近特征点的归一化距离，映射到约 [-1, 1]。
 * @param {number} seed
 */
export function createVoronoi3D(seed) {
	const rng = createRng(seed ^ 0x9e3779b9);

	function cellPoint(ix, iy, iz) {
		let h = ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1442695041;
		h = (h ^ (h >>> 13)) * 1274126177;
		h ^= h >>> 16;
		const rx = fract(h * 2.3283064365386963e-10);
		h = (h * 1103515245 + 12345) >>> 0;
		const ry = fract(h * 2.3283064365386963e-10);
		h = (h * 1103515245 + 12345) >>> 0;
		const rz = fract(h * 2.3283064365386963e-10);
		return { x: ix + rx, y: iy + ry, z: iz + rz };
	}

	return function noise3d(x, y, z) {
		const ix = Math.floor(x);
		const iy = Math.floor(y);
		const iz = Math.floor(z);
		let minD = Infinity;
		for (let dz = - 1; dz <= 1; dz ++) {
			for (let dy = - 1; dy <= 1; dy ++) {
				for (let dx = - 1; dx <= 1; dx ++) {
					const p = cellPoint(ix + dx, iy + dy, iz + dz);
					const ddx = x - p.x;
					const ddy = y - p.y;
					const ddz = z - p.z;
					const d = ddx * ddx + ddy * ddy + ddz * ddz;
					if (d < minD) minD = d;
				}
			}
		}
		const dist = Math.sqrt(minD);
		// 近似将 0..~0.87 映射到 [-1, 1]
		return dist * 2.2 - 0.85;
	};
}
