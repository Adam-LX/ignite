import { renderCarIconDataUrl } from "../visual/renderCarIcon";

const params = new URLSearchParams(location.search);
const carId = params.get("carId") ?? undefined;

try {
	const canvas = document.getElementById("icon-canvas");
	if (!(canvas instanceof HTMLCanvasElement)) {
		throw new Error("renderAppIcon: brak #icon-canvas");
	}
	const dataUrl = await renderCarIconDataUrl(carId ?? undefined, canvas);
	(
		window as unknown as { __iconPngBase64?: string }
	).__iconPngBase64 = dataUrl;
	document.body.dataset.iconReady = "1";
} catch (err) {
	document.body.dataset.iconError =
		err instanceof Error ? err.message : String(err);
	throw err;
}
