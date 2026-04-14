import { createRng } from './seededRandom.js';

const grad3 = [
	[ 1, 1, 0 ], [ -1, 1, 0 ], [ 1, -1, 0 ], [ -1, -1, 0 ],
	[ 1, 0, 1 ], [ -1, 0, 1 ], [ 1, 0, -1 ], [ -1, 0, -1 ],
	[ 0, 1, 1 ], [ 0, -1, 1 ], [ 0, 1, -1 ], [ 0, -1, -1 ],
];

function fade(t) {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
	return a + t * (b - a);
}

function dot(g, x, y, z) {
	return g[ 0 ] * x + g[ 1 ] * y + g[ 2 ] * z;
}

/**
 * 3D 梯度噪声（Perlin 风格），输出约 [-1, 1]。
 * @param {number} seed
 */
export function createPerlin3D(seed) {
	const rng = createRng(seed);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i ++) p[ i ] = i;
	for (let i = 255; i > 0; i --) {
		const j = Math.floor(rng() * (i + 1));
		[ p[ i ], p[ j ] ] = [ p[ j ], p[ i ] ];
	}
	const perm = new Uint16Array(512);
	for (let i = 0; i < 512; i ++) perm[ i ] = p[ i & 255 ];

	return function noise3d(x, y, z) {
		const X = Math.floor(x) & 255;
		const Y = Math.floor(y) & 255;
		const Z = Math.floor(z) & 255;
		const xf = x - Math.floor(x);
		const yf = y - Math.floor(y);
		const zf = z - Math.floor(z);
		const u = fade(xf);
		const v = fade(yf);
		const w = fade(zf);

		const A = perm[ X ] + Y;
		const AA = perm[ A ] + Z;
		const AB = perm[ A + 1 ] + Z;
		const B = perm[ X + 1 ] + Y;
		const BA = perm[ B ] + Z;
		const BB = perm[ B + 1 ] + Z;

		const g000 = grad3[ perm[ AA ] % 12 ];
		const g100 = grad3[ perm[ BA ] % 12 ];
		const g010 = grad3[ perm[ AB ] % 12 ];
		const g110 = grad3[ perm[ BB ] % 12 ];
		const g001 = grad3[ perm[ AA + 1 ] % 12 ];
		const g101 = grad3[ perm[ BA + 1 ] % 12 ];
		const g011 = grad3[ perm[ AB + 1 ] % 12 ];
		const g111 = grad3[ perm[ BB + 1 ] % 12 ];

		const n000 = dot(g000, xf, yf, zf);
		const n100 = dot(g100, xf - 1, yf, zf);
		const n010 = dot(g010, xf, yf - 1, zf);
		const n110 = dot(g110, xf - 1, yf - 1, zf);
		const n001 = dot(g001, xf, yf, zf - 1);
		const n101 = dot(g101, xf - 1, yf, zf - 1);
		const n011 = dot(g011, xf, yf - 1, zf - 1);
		const n111 = dot(g111, xf - 1, yf - 1, zf - 1);

		const nx00 = lerp(n000, n100, u);
		const nx01 = lerp(n001, n101, u);
		const nx10 = lerp(n010, n110, u);
		const nx11 = lerp(n011, n111, u);
		const nxy0 = lerp(nx00, nx10, v);
		const nxy1 = lerp(nx01, nx11, v);
		return lerp(nxy0, nxy1, w);
	};
}
