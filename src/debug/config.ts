/** Włącza 20s scenariusz diagnostyczny autopilota w pętli gry (tylko dev — produkcja: false). */
export const DEBUG_AUTOPILOT = false;

/** Czas trwania pełnego przejazdu testowego [s]. */
export const AUTOPILOT_DURATION_SEC = 20;

/** Tryb diagnostyczny — false = pełna gra z botami. */
export const HOVER_SAFE_MODE = false;

/** Rysuj 4 raycasty zawieszenia (zielony = hit, czerwony = miss). */
export const HOVER_DEBUG_RAYS = true;

/** Maks. dozwolona siła sprężyny [N] — powyżej = log CRITICAL + pominięcie impulsu. */
export const HOVER_FORCE_MAX = 50_000;

/** Co ile kroków fizyki (120 Hz) logować telemetrię hover w konsoli. 0 = wyłączone. */
export const HOVER_TELEMETRY_EVERY_STEPS = 120;
