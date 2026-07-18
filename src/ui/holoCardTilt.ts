/** Lekki tilt 3D kart holograficznych pod kursorem (bez logiki gry). */

const MAX_TILT_DEG = 11;

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function attachHoloCardTilt(card: HTMLElement): void {
	if (prefersReducedMotion()) return;

	const onMove = (e: PointerEvent): void => {
		const rect = card.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return;
		const px = (e.clientX - rect.left) / rect.width;
		const py = (e.clientY - rect.top) / rect.height;
		const rotY = (px - 0.5) * 2 * MAX_TILT_DEG;
		const rotX = (0.5 - py) * 2 * MAX_TILT_DEG;
		card.classList.add("is-tilting");
		card.style.setProperty("--tilt-x", `${rotX.toFixed(2)}deg`);
		card.style.setProperty("--tilt-y", `${rotY.toFixed(2)}deg`);
	};

	const onLeave = (): void => {
		card.classList.remove("is-tilting");
		card.style.removeProperty("--tilt-x");
		card.style.removeProperty("--tilt-y");
	};

	card.addEventListener("pointermove", onMove);
	card.addEventListener("pointerleave", onLeave);
	card.addEventListener("pointercancel", onLeave);
}
