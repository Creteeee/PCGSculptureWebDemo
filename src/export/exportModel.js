import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { applyPbrParams } from '../materials/sculptureMaterial.js';

/**
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/**
 * 使用当前几何与 PBR 参数导出（不受线框/法线预览模式影响）。
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {import('../materials/sculptureMaterial.js').PbrState} materialParams
 * @param {'glb'|'obj'} format
 */
export async function exportSculpture(geometry, materialParams, format) {
	const geo = geometry.clone();
	const mat = new THREE.MeshPhysicalMaterial();
	mat.wireframe = false;
	applyPbrParams(mat, materialParams);
	const mesh = new THREE.Mesh(geo, mat);
	mesh.name = 'PCGSculpture';

	if (format === 'obj') {
		const exporter = new OBJExporter();
		const text = exporter.parse(mesh);
		downloadBlob(new Blob( [ text ], { type: 'text/plain;charset=utf-8' } ), 'pcg-sculpture.obj' );
		return;
	}

	const exporter = new GLTFExporter();
	const result = await exporter.parseAsync(mesh, { binary: true });
	if (result instanceof ArrayBuffer) {
		downloadBlob(new Blob( [ result ], { type: 'model/gltf-binary' } ), 'pcg-sculpture.glb' );
	} else {
		throw new Error('GLB 导出失败：未得到二进制数据');
	}
}
