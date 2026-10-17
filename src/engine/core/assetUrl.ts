/** Public assets — poprawne w dev (/) i Electron file:// (base ./). */
export function assetUrl(path: string): string {
	if (/^https?:\/\//i.test(path)) return path;
	return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}
