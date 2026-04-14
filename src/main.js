import './style.css';
import * as THREE from 'three';
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

const projectionHooks = [];

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
		shadows: true,
	},
	export: {
		format: 'glb',
	},
};

document.querySelector('#app').innerHTML = `
<div class="layout">
  <main class="viewport" id="viewport"></main>
  <aside class="panel">
    <h1>PCG 雕塑预览</h1>
    <p class="sub">椭球体 + 噪声位移 · OrbitControls 拖拽旋转 / 滚轮缩放</p>
    <div id="gui-mount"></div>
    <p class="hint">噪声为程序生成，无需贴图。若部署到 GitHub Pages，请把 vite.config.js 里的 base 改成你的仓库路径。</p>
  </aside>
</div>
`;

const viewport = document.getElementById('viewport');
const { scene, camera, renderer, controls, dispose } = createSceneCore(viewport);

const lighting = createLightingRig(scene, { hooks: projectionHooks });

const sculpture = createSculptureMesh(168, 84);
scene.add(sculpture);

const pbrMaterial = sculpture.material;
const normalMaterial = createNormalPreviewMaterial(pbrMaterial);

function syncSculpture() {
	rebuildSculptureVertices(sculpture, state.sculpture);
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
		},
		state.light.shadows,
	);
	renderer.shadowMap.enabled = state.light.shadows;
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
	onExport,
});

syncSculpture();
syncMaterial();
syncPreview();
syncLight();

function animate() {
	requestAnimationFrame(animate);
	controls.update();
	runProjectionHooks(lighting);
	renderer.render(scene, camera);
}
animate();

window.addEventListener('beforeunload', () => {
	dispose();
});
