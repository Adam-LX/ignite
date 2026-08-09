/**
 * Po zapisie klipu F9 — publikuj „latest” w data/gameplay-clips/
 * żeby agent mógł od razu wziąć ostatni materiał.
 */
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function defaultRepoRoot() {
	return join(HERE, "..");
}

export function gameplayClipsDir(repoRoot = defaultRepoRoot()) {
	return join(repoRoot, "data", "gameplay-clips");
}

/**
 * @param {{
 *   repoRoot?: string;
 *   videoPath: string;
 *   inputLogJson?: string | null;
 *   baseName: string;
 *   videosPath?: string;
 * }} opts
 */
export function publishGameplayClipLatest(opts) {
	const repoRoot = opts.repoRoot ?? defaultRepoRoot();
	const dir = gameplayClipsDir(repoRoot);
	mkdirSync(dir, { recursive: true });

	let videoPath = opts.videoPath;
	try {
		const st = statSync(videoPath);
		if (st.size < 64) {
			/** Puste MP4 po ffmpeg — spróbuj webm obok. */
			const webmGuess = videoPath.replace(/\.mp4$/i, ".webm");
			if (webmGuess !== videoPath && existsSync(webmGuess) && statSync(webmGuess).size >= 64) {
				videoPath = webmGuess;
			} else {
				console.warn("[ignite-clip] skip latest — video too small", videoPath, st.size);
				/** Input log i tak zapisz. */
				if (opts.inputLogJson && opts.inputLogJson.length > 2) {
					writeFileSync(join(dir, "latest.inputs.json"), opts.inputLogJson, "utf8");
				}
				writeFileSync(
					join(dir, "latest.json"),
					JSON.stringify(
						{
							updatedAt: new Date().toISOString(),
							baseName: opts.baseName,
							video: null,
							inputs: opts.inputLogJson ? "latest.inputs.json" : null,
							videosCopy: opts.videosPath ?? null,
							error: "video empty/green — input only",
							agentHint:
								'Adam mówi „zobacz klip” → latest.inputs.json (wideo puste).',
						},
						null,
						2,
					),
				);
				return { dir, latestVideo: null, manifest: null };
			}
		}
	} catch (err) {
		console.warn("[ignite-clip] video stat fail", err);
	}

	const ext = videoPath.toLowerCase().endsWith(".mp4") ? ".mp4" : ".webm";
	const latestVideo = join(dir, `latest${ext}`);
	const otherExt = ext === ".mp4" ? ".webm" : ".mp4";
	const otherVideo = join(dir, `latest${otherExt}`);

	copyFileSync(videoPath, latestVideo);
	if (existsSync(otherVideo)) {
		try {
			unlinkSync(otherVideo);
		} catch {
			/* ignore */
		}
	}

	if (opts.inputLogJson && opts.inputLogJson.length > 2) {
		writeFileSync(join(dir, "latest.inputs.json"), opts.inputLogJson, "utf8");
	}

	const manifest = {
		updatedAt: new Date().toISOString(),
		baseName: opts.baseName,
		video: `latest${ext}`,
		inputs: opts.inputLogJson ? "latest.inputs.json" : null,
		videosCopy: opts.videosPath ?? null,
		agentHint:
			'Adam mówi „zobacz klip” / „dziwne obserwacje” → czytaj ten folder (latest.*).',
	};
	writeFileSync(join(dir, "latest.json"), JSON.stringify(manifest, null, 2));

	const obs = join(dir, "observations.md");
	if (!existsSync(obs)) {
		writeFileSync(
			obs,
			[
				"# Obserwacje do ostatniego klipu",
				"",
				"Opcjonalnie dopisz tu co zauważyłeś (1–3 zdania).",
				"Albo tylko napisz na czacie: **zobacz klip** / **dziwne obserwacje**.",
				"",
				"---",
				"",
			].join("\n"),
			"utf8",
		);
	}

	return { dir, latestVideo, manifest };
}
