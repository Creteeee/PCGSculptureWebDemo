import * as THREE from 'three';

let cachedGrassTextures = null;
function getGrassTextures() {
	if (cachedGrassTextures) return cachedGrassTextures;

	const base = import.meta.env.BASE_URL || '/';
	const loader = new THREE.TextureLoader();
	const albedo = loader.load(`${base}textures/grass_albedo.png`);
	const alpha = loader.load(`${base}textures/grass_alpha.png`);

	albedo.colorSpace = THREE.SRGBColorSpace;
	alpha.colorSpace = THREE.NoColorSpace;

	for (const tex of [ albedo, alpha ]) {
		tex.wrapS = THREE.ClampToEdgeWrapping;
		tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.anisotropy = 4;
	}

	cachedGrassTextures = { albedo, alpha };
	return cachedGrassTextures;
}

function buildGrassMaterial({
	roughness = 1,
	metalness = 0,
	alphaTest = 0.55,
	windStrength = 0.18,
	bladeHeight = 0.7,
} = {}) {
	const { albedo, alpha } = getGrassTextures();
	const mat = new THREE.MeshStandardMaterial({
		map: albedo,
		alphaMap: alpha,
		transparent: true,
		alphaTest,
		roughness,
		metalness,
		side: THREE.DoubleSide,
	});

	mat.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = { value: 0 };
		shader.uniforms.uWindStrength = { value: windStrength };
		shader.uniforms.uBladeHeight = { value: bladeHeight };

		shader.vertexShader =
			/* glsl */ `
uniform float uTime;
uniform float uWindStrength;
uniform float uBladeHeight;
attribute vec3 instanceOffset;
` + shader.vertexShader;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			/* glsl */ `
#include <begin_vertex>
// wind gradient: stronger near the tip, weaker at the root
float h = clamp(position.y / max(0.0001, uBladeHeight), 0.0, 1.0);
float w = sin(uTime * 1.35 + instanceOffset.x * 3.1 + instanceOffset.z * 2.7) * uWindStrength;
transformed.x += w * h;
transformed.z += w * 0.35 * h;
`,
		);

		mat.userData.shader = shader;
	};

	return mat;
}

function rand(seed) {
	// deterministic LCG
	let s = seed >>> 0;
	return () => {
		s = (1664525 * s + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}

/**
 * 插片草坪：InstancedMesh（默认单插片；可用 crossBlades 生成十字草）
 *
 * @param {{
 *   count?: number,
 *   radius?: number,
 *   y?: number,
 *   seed?: number,
 *   bladeHeight?: number,  // 调整“长度”：只影响面片高度
 *   bladeWidth?: number,
 *   bladeSize?: number,    // 调整“大小”：等比缩放长宽
 *   crossBlades?: boolean,
 *   windStrength?: number,
 * }} [options]
 */
export function createGrassField(options = {}) {
	const {
		count = 1200,
		radius = 9,
		y = -1.2,
		seed = 7,
		bladeHeight = 0.7,
		bladeWidth = 0.16,
		bladeSize = 1,
		crossBlades = false,
		windStrength = 0.18,
	} = options;

	const prng = rand(seed);
	// 3x3 segmentation for smoother wind deformation
	const bladeGeo = new THREE.PlaneGeometry(bladeWidth, bladeHeight, 3, 3);
	bladeGeo.translate(0, bladeHeight * 0.5, 0); // pivot at bottom

	const instCount = crossBlades ? count * 2 : count;
	const material = buildGrassMaterial({ windStrength, bladeHeight });
	const mesh = new THREE.InstancedMesh(bladeGeo, material, instCount);
	mesh.frustumCulled = true;
	mesh.castShadow = false;
	mesh.receiveShadow = false;

	const offsets = new Float32Array(instCount * 3);
	const m = new THREE.Matrix4();
	const pos = new THREE.Vector3();
	const q = new THREE.Quaternion();
	const s = new THREE.Vector3();

	for (let i = 0; i < count; i++) {
		// uniform-ish disk distribution
		const r = Math.sqrt(prng()) * radius;
		const a = prng() * Math.PI * 2;
		pos.set(Math.cos(a) * r, y, Math.sin(a) * r);

		const yaw = prng() * Math.PI * 2;
		const scale = 0.65 + prng() * 0.7;
		s.set(scale * bladeSize, scale * bladeSize, scale * bladeSize);

		// primary blade
		q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
		m.compose(pos, q, s);
		mesh.setMatrixAt(crossBlades ? i * 2 : i, m);

		const oi = (crossBlades ? i * 2 : i) * 3;
		offsets[oi] = pos.x;
		offsets[oi + 1] = pos.y;
		offsets[oi + 2] = pos.z;

		if (crossBlades) {
			// secondary blade rotated 90deg
			q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI * 0.5);
			m.compose(pos, q, s);
			mesh.setMatrixAt(i * 2 + 1, m);
			offsets[oi + 3] = pos.x;
			offsets[oi + 4] = pos.y;
			offsets[oi + 5] = pos.z;
		}
	}

	mesh.instanceMatrix.needsUpdate = true;
	mesh.geometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsets, 3));

	function setTime(t) {
		const shader = material.userData.shader;
		if (shader) shader.uniforms.uTime.value = t;
	}

	function update(params = {}) {
		if (typeof params.windStrength === 'number') {
			const shader = material.userData.shader;
			if (shader) shader.uniforms.uWindStrength.value = params.windStrength;
		}
		if (typeof params.bladeHeight === 'number') {
			const shader = material.userData.shader;
			if (shader) shader.uniforms.uBladeHeight.value = params.bladeHeight;
		}
	}

	function dispose() {
		// textures are cached globally; do not dispose here
		material.dispose();
		bladeGeo.dispose();
	}

	return { mesh, setTime, update, dispose };
}

