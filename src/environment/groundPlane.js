import * as THREE from 'three';

let cachedGroundTexture = null;
function getGroundTexture() {
	if (cachedGroundTexture) return cachedGroundTexture;

	const base = import.meta.env.BASE_URL || '/';
	const loader = new THREE.TextureLoader();
	const tex = loader.load(`${base}textures/grass_land.jpg`);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.anisotropy = 8;
	cachedGroundTexture = tex;
	return tex;
}

/**
 * @param {{
 *   size?: number,
 *   y?: number,
 *   repeat?: number,
 *   receiveShadow?: boolean,
 * }} [options]
 */
export function createGroundPlane(options = {}) {
	const {
		size = 30,
		y = -1.205,
		repeat = 6,
		receiveShadow = true,
	} = options;

	const map = getGroundTexture();
	map.repeat.set(repeat, repeat);

	const geo = new THREE.PlaneGeometry(size, size, 1, 1);
	geo.rotateX(-Math.PI * 0.5);

	const mat = new THREE.MeshStandardMaterial({
		map,
		roughness: 1,
		metalness: 0,
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.position.y = y;
	mesh.receiveShadow = receiveShadow;
	mesh.castShadow = false;

	function dispose() {
		geo.dispose();
		mat.dispose();
		// shared texture (cached) - do not dispose here
	}

	return { mesh, dispose };
}

