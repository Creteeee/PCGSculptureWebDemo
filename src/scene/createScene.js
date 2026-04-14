import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * @param {HTMLElement} mountEl
 */
export function createSceneCore(mountEl) {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x6a6e72);

	const camera = new THREE.PerspectiveCamera(
		45,
		mountEl.clientWidth / Math.max(1, mountEl.clientHeight),
		0.1,
		200,
	);
	camera.position.set(5.5, 3.2, 6.5);

	const renderer = new THREE.WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1;
	mountEl.appendChild(renderer.domElement);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.target.set(0, 0, 0);
	controls.minDistance = 2;
	controls.maxDistance = 40;

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
	scene.environment = envTex;
	pmrem.dispose();

	const grid = new THREE.GridHelper(20, 40, 0x444444, 0x3a3a3a);
	grid.position.y = -1.2;
	scene.add(grid);

	function onResize() {
		const w = mountEl.clientWidth;
		const h = Math.max(1, mountEl.clientHeight);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		renderer.setSize(w, h);
	}
	window.addEventListener('resize', onResize);

	function dispose() {
		window.removeEventListener('resize', onResize);
		renderer.dispose();
		envTex.dispose();
	}

	return {
		scene,
		camera,
		renderer,
		controls,
		onResize,
		dispose,
	};
}
