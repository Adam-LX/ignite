export { assetUrl } from "./assetUrl";
export {
	type GraphicsQuality,
	type GraphicsSettings,
	type GraphicsProfile,
	detectLowPowerDevice,
	detectGraphicsProfile,
	resolveGraphicsSettings,
	rainParticleCountForQuality,
	rainGlintStrengthForQuality,
	getStoredGraphicsQuality,
	setGraphicsQuality,
	cycleGraphicsQuality,
} from "./graphicsProfile";

/** Core loop primitives — still live at repo root; re-exported for engine surface. */
export { default as Scene } from "../../Scene";
export { default as GameObject } from "../../GameObject";
export { default as Renderer } from "../../Renderer";
