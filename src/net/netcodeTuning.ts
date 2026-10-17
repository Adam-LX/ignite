/** Netcode — interpolacja, jitter buffer, reconciliacja gościa. */
export const NETCODE = {
	/** Bazowy bufor renderowania (~3 klatki @ 60 Hz). */
	BASE_INTERPOLATION_DELAY_MS: 50,
	MIN_INTERPOLATION_DELAY_MS: 35,
	MAX_INTERPOLATION_DELAY_MS: 120,
	/** EMA wagi dla jittera i synchronizacji zegara hosta. */
	JITTER_SMOOTHING: 0.15,
	CLOCK_SYNC_SMOOTHING: 0.12,
	/** Maks. dead-reckoning poza najnowszym snapshotem. */
	EXTRAPOLATION_MAX_MS: 80,
	/** Szybkość ściągania błędu predykcji (1/s). */
	RECONCILE_RATE: 14,
	/** Teleport zamiast blendu przy dużym rozjechu (m). */
	RECONCILE_SNAP_DIST_M: 4,
	BUFFER_MAX: 16,
	EXPECTED_SNAPSHOT_INTERVAL_MS: 1000 / 60,
} as const;
