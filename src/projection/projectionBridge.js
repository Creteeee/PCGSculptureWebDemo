/**
 * 与 lightingRig 中的 extension.registerProjectionHook 配合使用。
 * 后续可在参数变更或动画循环里调用 runProjectionHooks。
 *
 * @param {import('../lighting/lightingRig.js').LightingContext} lightingCtx
 */
export function runProjectionHooks(lightingCtx) {
	const hooks = lightingCtx.extension.projectionHooks;
	for (let i = 0; i < hooks.length; i ++) {
		hooks[ i ](lightingCtx);
	}
}
