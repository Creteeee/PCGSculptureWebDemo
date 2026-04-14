import GUI from 'lil-gui';

/**
 * @param {HTMLElement} container
 * @param {object} state
 * @param {{
 *   onSculptureChange: () => void,
 *   onMaterialChange: () => void,
 *   onPreviewChange: () => void,
 *   onLightChange: () => void,
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
