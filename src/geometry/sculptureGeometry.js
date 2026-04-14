import * as THREE from 'three';
import { sampleNoise } from '../noise/noiseSampler.js';

const _v = new THREE.Vector3();

/**
 * @typedef {import('../noise/noiseSampler.js').NoiseType} NoiseType
 */

/**
 * @param {number} widthSeg
 * @param {number} heightSeg
 */
export function createSculptureMesh(widthSeg = 160, heightSeg = 80) {
	const geo = new THREE.SphereGeometry(1, widthSeg, heightSeg);
	const base = new Float32Array(geo.attributes.position.array.length);
	base.set(geo.attributes.position.array);
	geo.userData.basePositions = base;

	const mat = new THREE.MeshPhysicalMaterial({
		color: 0xb01020,
		metalness: 0.35,
		roughness: 0.12,
		envMapIntensity: 1.2,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	return mesh;
}

/**
 * @param {THREE.Mesh} mesh
 * @param {{
 *   length: number,
 *   width: number,
 *   height: number,
 *   noiseType: NoiseType,
 *   noiseAmplitude: number,
 *   noiseFrequency: number,
 *   noiseTiling: number,
 *   noiseSeed: number,
 * }} params
 */
export function rebuildSculptureVertices(mesh, params) {
	const geo = mesh.geometry;
	const base = geo.userData.basePositions;
	if (!base) return;

	const pos = geo.attributes.position;
	const arr = pos.array;
	const hx = params.length * 0.5;
	const hy = params.height * 0.5;
	const hz = params.width * 0.5;

	const nOpts = {
		frequency: params.noiseFrequency,
		tiling: params.noiseTiling,
		seed: Math.floor(params.noiseSeed),
	};

	for (let i = 0; i < arr.length; i += 3) {
		const bx = base[ i ];
		const by = base[ i + 1 ];
		const bz = base[ i + 2 ];
		const il = 1 / Math.sqrt(bx * bx + by * by + bz * bz) || 1;
		const ux = bx * il;
		const uy = by * il;
		const uz = bz * il;

		const n = sampleNoise(params.noiseType, ux, uy, uz, nOpts);
		const disp = params.noiseAmplitude * n;

		arr[ i ] = ux * hx + ux * disp;
		arr[ i + 1 ] = uy * hy + uy * disp;
		arr[ i + 2 ] = uz * hz + uz * disp;
	}

	pos.needsUpdate = true;
	geo.computeVertexNormals();
}
