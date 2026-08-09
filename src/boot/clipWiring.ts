import type Renderer from "../Renderer";
import { GameplayClipRecorder } from "../engine/clip/GameplayClipRecorder";
import type GameInput from "../engine/input/GameInput";

export type ClipWiring = {
	clipRecorder: GameplayClipRecorder;
	bindInputProvider: (input: GameInput) => void;
	dispose: () => void;
};

/**
 * F9 clip recorder + on-screen badge. Call once after Renderer exists.
 */
export function wireGameplayClips(opts: { renderer: Renderer }): ClipWiring {
	const clipRecorder = new GameplayClipRecorder(
		() => opts.renderer.getCaptureCanvas(),
		() => opts.renderer.blitForClipCapture(),
	);
	opts.renderer.setClipFrameHook(() => clipRecorder.onFrameRendered());

	const clipBadge = document.getElementById("clip-rec-badge");
	const setClipBadge = (
		mode: "recording" | "saving" | "saved" | "error" | "idle",
		title: string,
		sub = "",
	) => {
		if (!clipBadge) return;
		clipBadge.classList.remove(
			"hidden",
			"is-recording",
			"is-saving",
			"is-saved",
			"is-error",
		);
		if (mode === "idle") {
			clipBadge.hidden = true;
			clipBadge.classList.add("hidden");
			clipBadge.textContent = "";
			document.body.classList.remove("clip-recording");
			return;
		}
		clipBadge.hidden = false;
		clipBadge.classList.add(`is-${mode}`);
		document.body.classList.toggle("clip-recording", mode === "recording");
		clipBadge.innerHTML = `<span class="clip-rec-badge__ico" aria-hidden="true"></span><span class="clip-rec-badge__stack"><span class="clip-rec-badge__title">${title}</span>${sub ? `<span class="clip-rec-badge__sub">${sub}</span>` : ""}</span>`;
	};

	const formatClipSec = (ms: number) => {
		const s = Math.min(30, Math.ceil(ms / 1000));
		return `${s}`;
	};

	const unsubStatus = clipRecorder.onStatus((st) => {
		opts.renderer.setClipCaptureActive(st.kind === "recording");
		if (st.kind === "recording") {
			setClipBadge(
				"recording",
				`NAGRYWANIE  ${formatClipSec(st.elapsedMs)}s / 30s`,
				"F9 = stop · input w pliku · nie zamykaj gry",
			);
			return;
		}
		if (st.kind === "saving") {
			setClipBadge("saving", "ZAPISUJĘ…", "czekaj na SAVED");
			return;
		}
		if (st.kind === "saved") {
			const short =
				st.path.length > 48 ? `…${st.path.slice(-46)}` : st.path;
			setClipBadge("saved", "ZAPISANO", short);
			window.setTimeout(() => {
				if (clipRecorder.getStatus().kind === "saved") {
					setClipBadge("idle", "");
				}
			}, 4500);
			return;
		}
		if (st.kind === "error") {
			setClipBadge("error", "BŁĄD KLIPU", st.message);
			window.setTimeout(() => {
				if (clipRecorder.getStatus().kind === "error") {
					setClipBadge("idle", "");
				}
			}, 4000);
			return;
		}
		setClipBadge("idle", "");
	});

	const onKey = (e: KeyboardEvent) => {
		if (e.code !== "F9") return;
		if (e.repeat) return;
		e.preventDefault();
		clipRecorder.toggle();
	};
	window.addEventListener("keydown", onKey);

	(
		window as unknown as { __igniteClipRecorder?: GameplayClipRecorder }
	).__igniteClipRecorder = clipRecorder;

	const bindInputProvider = (input: GameInput) => {
		clipRecorder.setInputProvider(() => {
			input.pollGamepad();
			return input.getClipInputSnapshot();
		});
	};

	return {
		clipRecorder,
		bindInputProvider,
		dispose: () => {
			if (typeof unsubStatus === "function") unsubStatus();
			window.removeEventListener("keydown", onKey);
			opts.renderer.setClipFrameHook(null);
			delete (
				window as unknown as { __igniteClipRecorder?: GameplayClipRecorder }
			).__igniteClipRecorder;
		},
	};
}
