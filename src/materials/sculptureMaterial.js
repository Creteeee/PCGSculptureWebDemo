import * as THREE from 'three';

/** @typedef {'solid' | 'wireframe' | 'normal'} PreviewMode */

/**
 * @typedef {object} PbrState
 * @property {string} color
 * @property {number} metalness
 * @property {number} roughness
 * @property {number} envMapIntensity
 */

/**
 * @param {THREE.MeshPhysicalMaterial} pbrMat
 */
export function createNormalPreviewMaterial(pbrMat) {
	return new THREE.MeshNormalMaterial({
		flatShading: false,
		wireframe: pbrMat.wireframe,
	});
}

/**
 * @param {THREE.Mesh} mesh
 * @param {THREE.MeshPhysicalMaterial} pbrMaterial
 * @param {THREE.MeshNormalMaterial} normalMaterial
 * @param {PreviewMode} mode
 */
export function applyPreviewMode(mesh, pbrMaterial, normalMaterial, mode) {
	switch (mode) {
	case 'solid':
		pbrMaterial.wireframe = false;
		mesh.material = pbrMaterial;
		break;
	case 'wireframe':
		pbrMaterial.wireframe = true;
		mesh.material = pbrMaterial;
		break;
	case 'normal':
		normalMaterial.wireframe = false;
		mesh.material = normalMaterial;
		break;
	default:
		pbrMaterial.wireframe = false;
		mesh.material = pbrMaterial;
	}
}

/**
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {{
 *   color: string,
 *   metalness: number,
 *   roughness: number,
 *   envMapIntensity: number,
 * }} p
 */
export function applyPbrParams(mat, p) {
	mat.color.set(p.color);
	mat.metalness = p.metalness;
	mat.roughness = p.roughness;
	mat.envMapIntensity = p.envMapIntensity;
	mat.needsUpdate = true;
}
