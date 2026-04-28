import GUI from 'lil-gui';

/**
 * @param {HTMLElement} container
 * @param {object} state
 * @param {{
 *   onSculptureChange: () => void,
 *   onMaterialChange: () => void,
 *   onPreviewChange: () => void,
 *   onLightChange: () => void,
 *   onSkyboxChange?: () => void,
 *   onGrassChange?: () => void,
 *   onProjectionChange?: () => void,
 *   onPerfChange?: () => void,
 *   onExport: () => void,
 * }} callbacks
 */
export function setupGui(container, state, callbacks) {
	const gui = new GUI({ title: '参数', container });

	const fSculpt = gui.addFolder('雕塑');
	fSculpt.add(state.sculpture, 'length', 0.5, 12, 0.05).name('长度 (X)').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'width', 0.5, 12, 0.05).name('宽度 (Z)').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'height', 0.2, 8, 0.05).name('高度 (Y)').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'noiseType', [ 'perlin', 'simplex', 'voronoi' ]).name('噪声类型').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'noiseAmplitude', 0, 1.5, 0.005).name('噪声幅度').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'noiseFrequency', 0.1, 6, 0.05).name('频率').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'noiseTiling', 0, 1, 0.01).name('Tiling').onChange(callbacks.onSculptureChange);
	fSculpt.add(state.sculpture, 'noiseSeed', 0, 9999, 1).name('随机种子').onChange(callbacks.onSculptureChange);

	const fMat = gui.addFolder('材质 (PBR)');
	fMat.addColor(state.material, 'color').name('颜色').onChange(callbacks.onMaterialChange);
	fMat.add(state.material, 'metalness', 0, 1, 0.01).name('Metalness').onChange(callbacks.onMaterialChange);
	fMat.add(state.material, 'roughness', 0, 1, 0.01).name('Roughness').onChange(callbacks.onMaterialChange);
	fMat.add(state.material, 'envMapIntensity', 0, 3, 0.05).name('环境反射强度').onChange(callbacks.onMaterialChange);

	const fPrev = gui.addFolder('预览模式');
	fPrev.add(state.preview, 'mode', {
		实体: 'solid',
		线框: 'wireframe',
		法线: 'normal',
	}).name('显示模式').onChange(callbacks.onPreviewChange);

	const fLight = gui.addFolder('灯光');
	fLight.add(state.light, 'ambientIntensity', 0, 2, 0.02).name('环境光强度').onChange(callbacks.onLightChange);
	fLight.add(state.light, 'dirIntensity', 0, 4, 0.02).name('主光强度').onChange(callbacks.onLightChange);
	fLight.add(state.light, 'dirX', -20, 20, 0.1).name('主光 X').onChange(callbacks.onLightChange);
	fLight.add(state.light, 'dirY', 0, 30, 0.1).name('主光 Y').onChange(callbacks.onLightChange);
	fLight.add(state.light, 'dirZ', -20, 20, 0.1).name('主光 Z').onChange(callbacks.onLightChange);
	fLight.add(state.light, 'shadows').name('阴影').onChange(callbacks.onLightChange);
	if (state.light.shadowMapSize !== undefined) {
		fLight.add(state.light, 'shadowMapSize', [ 512, 1024, 2048, 4096 ]).name('阴影分辨率').onChange(callbacks.onLightChange);
	}

	if (state.skybox) {
		const fSky = gui.addFolder('天空盒');
		fSky.add(state.skybox, 'enabled').name('启用').onChange(() => callbacks.onSkyboxChange?.());
		fSky.add(state.skybox, 'background').name('背景').onChange(() => callbacks.onSkyboxChange?.());
		fSky.add(state.skybox, 'environment').name('参与环境光照').onChange(() => callbacks.onSkyboxChange?.());
		fSky.add(state.skybox, 'size', [ 128, 256, 512, 1024 ]).name('纹理尺寸').onChange(() => callbacks.onSkyboxChange?.());
		if (state.skybox.topColor !== undefined) {
			fSky.addColor(state.skybox, 'topColor').name('顶部颜色').onChange(() => callbacks.onSkyboxChange?.());
		}
		if (state.skybox.bottomColor !== undefined) {
			fSky.addColor(state.skybox, 'bottomColor').name('底部颜色').onChange(() => callbacks.onSkyboxChange?.());
		}
	}

	if (state.grass) {
		// 草地功能按需求全局关闭：不在 GUI 暴露任何草地参数
	}

	if (state.projection) {
		const fProj = gui.addFolder('建筑物投影');
		fProj.add(state.projection, 'enabled').name('启用').onChange(() => callbacks.onProjectionChange?.());
		fProj.add(state.projection, 'opacity', 0, 1, 0.01).name('透明度').onChange(() => callbacks.onProjectionChange?.());
		fProj.add(state.projection, 'tiling', 0.1, 10, 0.1).name('Tiling').onChange(() => callbacks.onProjectionChange?.());

		// Texture preview (updated by main.js syncProjection)
		const previewWrap = document.createElement('div');
		previewWrap.style.marginTop = '8px';
		previewWrap.style.padding = '6px';
		previewWrap.style.border = '1px solid rgba(255,255,255,0.15)';
		previewWrap.style.borderRadius = '6px';

		const previewTitle = document.createElement('div');
		previewTitle.textContent = '图样预览';
		previewTitle.style.fontSize = '12px';
		previewTitle.style.opacity = '0.9';
		previewTitle.style.marginBottom = '6px';

		const img = document.createElement('img');
		img.id = 'projection-texture-preview';
		img.alt = 'projection texture preview';
		img.src = String(state.projection.textureUrl || 'textures/T_Mapping.png');
		img.style.width = '100%';
		img.style.maxWidth = '220px';
		img.style.height = '100px';
		img.style.objectFit = 'cover';
		img.style.display = 'block';
		img.style.borderRadius = '4px';
		img.style.background = 'rgba(0,0,0,0.25)';

		previewWrap.appendChild(previewTitle);
		previewWrap.appendChild(img);
		fProj.domElement.appendChild(previewWrap);
	}

	if (state.perf) {
		const fPerf = gui.addFolder('性能');
		fPerf.add(state.perf, 'maxPixelRatio', 1, 2, 0.05).name('像素比上限').onChange(() => callbacks.onPerfChange?.());
		fPerf.add(state.perf, 'interactionPixelRatio', 1, 2, 0.05).name('交互时像素比').onChange(() => callbacks.onPerfChange?.());
	}

	const fExport = gui.addFolder('导出');
	fExport.add(state.export, 'format', {
		'GLB（含材质）': 'glb',
		'OBJ（仅网格）': 'obj',
	}).name('格式');
	fExport.add({ 导出模型: () => callbacks.onExport() }, '导出模型');

	fSculpt.open();
	fMat.open();
	fPrev.open();
	fLight.open();
	fExport.open();

	return gui;
}
