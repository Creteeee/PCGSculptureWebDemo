import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSceneCore } from './scene/createScene.js';
import { createLightingRig, applyLightingParams } from './lighting/lightingRig.js';
import { createSculptureMesh, rebuildSculptureVertices } from './geometry/sculptureGeometry.js';
import {
	applyPreviewMode,
	applyPbrParams,
	createNormalPreviewMaterial,
} from './materials/sculptureMaterial.js';
import { setupGui } from './ui/setupGui.js';
import { runProjectionHooks } from './projection/projectionBridge.js';
import { exportSculpture } from './export/exportModel.js';
import { applySkybox } from './environment/skybox.js';
import { createGrassField } from './vegetation/grassField.js';
import {
	applyBaseRendererQuality,
	attachInteractionQualityGuard,
	getDefaultQualityProfile,
} from './perf/quality.js';
import { deepMerge, loadDefaultState } from './config/loadDefaultState.js';
import { mountChatPanel } from './ui/chatPanel.js';
import { mountRenderGallery } from './ui/renderGallery.js';
import { loadSystemPrompt } from './config/loadSystemPrompt.js';
import { pushRenderHistory } from './ui/renderGallery.js';
import { CHAT_ENDPOINT_BASE, normalizeBaseUrl } from './config/chatEndpoint.js';

const projectionHooks = [];

const quality = getDefaultQualityProfile();

const state = {
	sculpture: {
		length: 4.2,
		width: 4.2,
		height: 1.1,
		noiseType: 'simplex',
		noiseAmplitude: 0.22,
		noiseFrequency: 1.35,
		noiseTiling: 0,
		noiseSeed: 7,
	},
	material: {
		color: '#b01020',
		metalness: 0.38,
		roughness: 0.11,
		envMapIntensity: 1.35,
	},
	preview: {
		mode: 'solid',
	},
	light: {
		ambientIntensity: 0.38,
		dirIntensity: 1.28,
		dirX: 6,
		dirY: 11,
		dirZ: 4.5,
		shadows: quality.shadowsEnabled,
		shadowMapSize: quality.shadowMapSize,
	},
	skybox: {
		enabled: quality.skybox.enabled,
		background: quality.skybox.background,
		environment: quality.skybox.environment,
		size: quality.skybox.size,
		topColor: '#b9d9ff',
		bottomColor: '#ffffff',
	},
	grass: {
		enabled: quality.grass.enabled,
		count: quality.grass.count,
		radius: quality.grass.radius,
		crossBlades: quality.grass.crossBlades,
		windStrength: quality.grass.windStrength,
		bladeHeight: 0.7,
		bladeWidth: 0.16,
		bladeSize: 1,
	},
	projection: {
		enabled: false,
		opacity: 0.35,
		tiling: 1.5,
		textureUrl: 'textures/T_Mapping.png',
	},
	perf: {
		maxPixelRatio: quality.maxPixelRatio,
		interactionPixelRatio: quality.interactionPixelRatio,
	},
	export: {
		format: 'glb',
	},
};

// Load default state from config file (optional)
const defaultState = await loadDefaultState();
if (defaultState) deepMerge(state, defaultState);

document.querySelector('#app').innerHTML = `
<div class="layout">
  <main class="viewport" id="viewport"></main>
  <aside class="panel">
    <h1>PCG 雕塑预览</h1>
    <p class="sub">椭球体 + 噪声位移 · OrbitControls 拖拽旋转 / 滚轮缩放</p>
    <div class="panel__topbar">
      <div class="modeTabs" role="tablist" aria-label="模式切换">
        <button id="tab-params" role="tab" aria-selected="true" type="button">参数模式</button>
        <button id="tab-chat" role="tab" aria-selected="false" type="button">对话模式</button>
        <button id="tab-gallery" role="tab" aria-selected="false" type="button">效果图</button>
      </div>
    </div>
    <div class="panel__content" id="panel-content" data-mode="params">
      <div id="gui-mount"></div>
      <div id="chat-mount"></div>
      <div id="gallery-mount"></div>
      <p class="hint">噪声为程序生成，无需贴图。若部署到 GitHub Pages，请把 vite.config.js 里的 base 改成你的仓库路径。</p>
    </div>
  </aside>
</div>
`;

const panelContent = document.getElementById('panel-content');
const tabParams = document.getElementById('tab-params');
const tabChat = document.getElementById('tab-chat');
const tabGallery = document.getElementById('tab-gallery');
const chatMount = document.getElementById('chat-mount');
const galleryMount = document.getElementById('gallery-mount');
let chatHandle = null;
let galleryHandle = null;
let cachedSystemPrompt = null;

async function getSystemPromptOnce() {
	if (cachedSystemPrompt) return cachedSystemPrompt;
	cachedSystemPrompt = await loadSystemPrompt();
	return cachedSystemPrompt;
}

function setMode(mode) {
	panelContent.dataset.mode = mode;
	tabParams.setAttribute('aria-selected', String(mode === 'params'));
	tabChat.setAttribute('aria-selected', String(mode === 'chat'));
	tabGallery.setAttribute('aria-selected', String(mode === 'gallery'));
	if (mode === 'chat' && !chatHandle) {
		chatHandle = mountChatPanel(chatMount, {
			getState: () => state,
			getSystemPrompt: () => getSystemPromptOnce(),
			captureViewportBase64: async () => {
				// Ensure a fresh frame before capture
				renderer.render(scene, camera);
				// NOTE: WebGL without preserveDrawingBuffer may still work in most browsers
				return renderer.domElement.toDataURL('image/jpeg', 0.92);
			},
			applyStatePatch: (patch) => {
				deepMerge(state, patch);
				// Sync all (simple & robust)
				syncSculpture();
				syncMaterial();
				syncPreview();
				syncLight();
				syncSkybox();
				syncGrass();
				syncProjection();
				syncPerf();
			},
			onRenderSaved: (item) => {
				pushRenderHistory(item);
				setMode('gallery');
			},
		});
	}
	if (mode === 'gallery' && !galleryHandle) {
		galleryHandle = mountRenderGallery(galleryMount);
	}
	if (mode === 'gallery') {
		galleryHandle?.refresh?.();
	}
}

tabParams.addEventListener('click', () => setMode('params'));
tabChat.addEventListener('click', () => setMode('chat'));
tabGallery.addEventListener('click', () => setMode('gallery'));

const viewport = document.getElementById('viewport');
const { scene, camera, renderer, controls, dispose } = createSceneCore(viewport);

const lighting = createLightingRig(scene, { hooks: projectionHooks });

const sculpture = createSculptureMesh(168, 84);
scene.add(sculpture);

const pbrMaterial = sculpture.material;
const normalMaterial = createNormalPreviewMaterial(pbrMaterial);

const FLOOR_Y = -1.2;

// Load baked gallery environment (GLB with embedded materials/textures)
const baseUrl = import.meta.env.BASE_URL || '/';
async function loadBakedGallery() {
	const glbUrl = `${baseUrl}models/VR_Gallery_Baked.glb`;
	const gltf = await new Promise((resolve, reject) =>
		new GLTFLoader().load(glbUrl, resolve, undefined, reject),
	);
	const root = gltf?.scene || gltf?.scenes?.[0];
	if (!root) throw new Error('GLB missing scene');
	root.name = 'VR_Gallery_Baked';

	root.traverse((obj) => {
		if (!obj.isMesh) return;
		obj.frustumCulled = false;
		obj.castShadow = false;
		obj.receiveShadow = true;

		const mats = Array.isArray(obj.material) ? obj.material : [ obj.material ];
		for (const m of mats) {
			if (!m) continue;
			if (m.map) m.map.anisotropy = 8;
			if (m.normalMap) m.normalMap.anisotropy = 8;
			if (m.roughnessMap) m.roughnessMap.anisotropy = 8;
			if (m.metalnessMap) m.metalnessMap.anisotropy = 8;
			if (m.aoMap) m.aoMap.anisotropy = 8;
			m.needsUpdate = true;
		}
	});

	// Make it 2x as requested
	root.scale.multiplyScalar(2);

	// Center to origin in XZ and sit on y=-1.2
	const box2 = new THREE.Box3().setFromObject(root);
	const center = new THREE.Vector3();
	box2.getCenter(center);
	root.position.x -= center.x;
	root.position.z -= center.z;
	const box3 = new THREE.Box3().setFromObject(root);
	root.position.y += FLOOR_Y - box3.min.y;

	// Put sculpture slightly above the gallery floor
	controls.target.set(0, FLOOR_Y + 0.8, 0);
	controls.update();

	scene.add(root);
}

// Fire-and-forget (fallback: scene still works without it)
loadBakedGallery().catch((e) => console.error('Failed to load gallery GLB:', e));

// Additive projection overlay on sculpture (dynamic textureUrl)
const projectionLoader = new THREE.TextureLoader();
projectionLoader.setCrossOrigin('anonymous');
let projectionTex = null;
let lastProjectionTexUrl = '';

function resolveTexUrl(u) {
	const s = String(u || '').trim();
	if (!s) return `${baseUrl}textures/T_Mapping.png`;
	if (/^https?:\/\//i.test(s)) return s;
	// allow "textures/xxx.png" relative to BASE_URL
	return `${baseUrl}${s.replace(/^\/+/, '')}`;
}

function setProjectionTexture(urlLike) {
	const url = resolveTexUrl(urlLike);
	if (url === lastProjectionTexUrl && projectionTex) return;

	// Update GUI preview (best-effort)
	try {
		const el = document.getElementById('projection-texture-preview');
		if (el && el.tagName === 'IMG') el.src = url;
	} catch {
		// ignore
	}

	const prev = projectionTex;
	projectionLoader.load(
		url,
		(tex) => {
			lastProjectionTexUrl = url;
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			tex.anisotropy = 8;

			projectionTex = tex;
			projectionMat.map = projectionTex;
			projectionMat.needsUpdate = true;
			if (prev && prev !== tex) prev.dispose?.();
		},
		undefined,
		async () => {
			// If cross-origin/CORS fails, keep previous texture so projection doesn't "disappear".
			// (Preview <img> may still load even when WebGL can't use it.)
			try {
				const endpoint = normalizeBaseUrl(CHAT_ENDPOINT_BASE);
				if (!endpoint) return;
				const headers = { 'Content-Type': 'application/json' };
				const resp = await fetch(`${endpoint}/proxy-image`, {
					method: 'POST',
					headers,
					body: JSON.stringify({ url }),
				});
				if (!resp.ok) return;
				const data = await resp.json();
				const dataUrl = typeof data?.dataUrl === 'string' ? data.dataUrl : '';
				if (!dataUrl) return;
				// Retry load from dataUrl (no CORS)
				projectionLoader.load(dataUrl, (tex) => {
					lastProjectionTexUrl = url;
					tex.colorSpace = THREE.SRGBColorSpace;
					tex.wrapS = THREE.RepeatWrapping;
					tex.wrapT = THREE.RepeatWrapping;
					tex.anisotropy = 8;
					projectionTex = tex;
					projectionMat.map = projectionTex;
					projectionMat.needsUpdate = true;
					if (prev && prev !== tex) prev.dispose?.();
				});
			} catch {
				// ignore
			}
		},
	);
}

const projectionMat = new THREE.MeshBasicMaterial({
	map: null,
	transparent: true,
	opacity: 0,
	blending: THREE.AdditiveBlending,
	depthWrite: false,
	depthTest: true,
	polygonOffset: true,
	polygonOffsetFactor: -1,
	polygonOffsetUnits: -1,
	toneMapped: false,
});
const projectionMesh = new THREE.Mesh(sculpture.geometry, projectionMat);
projectionMesh.castShadow = false;
projectionMesh.receiveShadow = false;
projectionMesh.visible = false;
projectionMesh.renderOrder = 10;
// Keep projection perfectly aligned with sculpture transform
projectionMesh.position.set(0, 0, 0);
projectionMesh.rotation.set(0, 0, 0);
projectionMesh.scale.set(1, 1, 1);
sculpture.add(projectionMesh);

function clampSculptureToFloor() {
	// Ensure sculpture bottom touches floor (y = FLOOR_Y)
	sculpture.geometry.computeBoundingBox();
	const bb = sculpture.geometry.boundingBox;
	if (!bb) return;
	// bb is in sculpture local space; position.y shifts it in world.
	sculpture.position.y = FLOOR_Y - bb.min.y;
}

// init texture once (can be replaced later)
setProjectionTexture(state.projection?.textureUrl);

// Quality guardrails (pixel ratio + shadows default)
applyBaseRendererQuality(renderer, { maxPixelRatio: state.perf.maxPixelRatio });
const detachPerfGuard = attachInteractionQualityGuard(controls, renderer, {
	maxPixelRatio: state.perf.maxPixelRatio,
	interactionPixelRatio: state.perf.interactionPixelRatio,
});

// Environment (skybox) + vegetation (grass)
let skyboxHandles = applySkybox(renderer, scene, state.skybox);
let grass = null;
let lastGrassKey = '';
function ensureGrass() {
	// 草地功能按需求全局关闭（老师不喜欢）：无论 state 如何都不创建草地
	if (state.grass) state.grass.enabled = false;
	if (!state.grass.enabled) {
		if (grass) {
			scene.remove(grass.mesh);
			grass.dispose();
			grass = null;
		}
		return;
	}
	const key = JSON.stringify({
		enabled: state.grass.enabled,
		count: state.grass.count,
		radius: state.grass.radius,
		crossBlades: state.grass.crossBlades,
		seed: state.sculpture.noiseSeed,
		bladeHeight: state.grass.bladeHeight,
		bladeWidth: state.grass.bladeWidth,
		bladeSize: state.grass.bladeSize,
	});
	const needsRebuild = !grass || key !== lastGrassKey;

	if (needsRebuild) {
		lastGrassKey = key;
		if (grass) {
			scene.remove(grass.mesh);
			grass.dispose();
			grass = null;
		}
		grass = createGrassField({
			count: state.grass.count,
			radius: state.grass.radius,
			y: -1.2,
			seed: state.sculpture.noiseSeed,
			crossBlades: state.grass.crossBlades,
			windStrength: state.grass.windStrength,
			bladeHeight: state.grass.bladeHeight,
			bladeWidth: state.grass.bladeWidth,
			bladeSize: state.grass.bladeSize,
		});
		scene.add(grass.mesh);
	}

	if (grass) {
		grass.update({ windStrength: state.grass.windStrength, bladeHeight: state.grass.bladeHeight });
	}
}

function syncSculpture() {
	rebuildSculptureVertices(sculpture, state.sculpture);
	clampSculptureToFloor();
	// keep grass seed loosely tied to sculpture seed when toggling
	if (grass) {
		scene.remove(grass.mesh);
		grass.dispose();
		grass = null;
		ensureGrass();
	}
}

function syncMaterial() {
	if (state.preview.mode === 'normal') return;
	applyPbrParams(pbrMaterial, state.material);
}

function syncPreview() {
	applyPreviewMode(sculpture, pbrMaterial, normalMaterial, state.preview.mode);
	if (state.preview.mode !== 'normal') {
		applyPbrParams(pbrMaterial, state.material);
	}
}

function syncLight() {
	applyLightingParams(
		lighting,
		{ intensity: state.light.ambientIntensity },
		{
			intensity: state.light.dirIntensity,
			x: state.light.dirX,
			y: state.light.dirY,
			z: state.light.dirZ,
			shadowMapSize: state.light.shadowMapSize,
		},
		state.light.shadows,
	);
	renderer.shadowMap.enabled = state.light.shadows;
}

function syncSkybox() {
	// NOTE: env/hdri textures are cached inside skybox.js; do not dispose them here.
	if (skyboxHandles?.cube) skyboxHandles.cube.dispose?.();
	skyboxHandles = applySkybox(renderer, scene, state.skybox);
}

function syncGrass() {
	ensureGrass();
}

	function syncProjection() {
		const p = state.projection || {};
		if (p.textureUrl !== undefined) setProjectionTexture(p.textureUrl);
		const on = !!p.enabled;
		projectionMesh.visible = on;
		projectionMat.opacity = on ? Math.max(0, Math.min(1, Number(p.opacity) || 0)) : 0;
		const t = Math.max(0.01, Number(p.tiling) || 1);
		if (projectionTex) {
			projectionTex.repeat.set(t, t);
			projectionTex.needsUpdate = true;
		}
	}

function syncPerf() {
	applyBaseRendererQuality(renderer, { maxPixelRatio: state.perf.maxPixelRatio });
}

async function onExport() {
	try {
		await exportSculpture(sculpture.geometry, state.material, state.export.format);
	} catch (err) {
		console.error(err);
		const msg = err instanceof Error ? err.message : String(err);
		window.alert(`导出失败：${msg}`);
	}
}

setupGui(document.getElementById('gui-mount'), state, {
	onSculptureChange: syncSculpture,
	onMaterialChange: syncMaterial,
	onPreviewChange: syncPreview,
	onLightChange: syncLight,
	onSkyboxChange: syncSkybox,
	onGrassChange: syncGrass,
		onProjectionChange: syncProjection,
	onPerfChange: syncPerf,
	onExport,
});

syncSculpture();
syncMaterial();
syncPreview();
syncLight();
syncSkybox();
ensureGrass();
	syncProjection();
clampSculptureToFloor();

function animate() {
	requestAnimationFrame(animate);
	controls.update();
	runProjectionHooks(lighting);
	if (grass) grass.setTime(performance.now() * 0.001);
	renderer.render(scene, camera);
}
animate();

window.addEventListener('beforeunload', () => {
	detachPerfGuard?.();
	if (grass) grass.dispose();
	projectionMat.dispose();
	chatHandle?.dispose?.();
	galleryHandle?.dispose?.();
	if (skyboxHandles?.cube) skyboxHandles.cube.dispose?.();
	dispose();
});
