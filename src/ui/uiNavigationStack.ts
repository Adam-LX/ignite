/**
 * Jednolity powrót z ekranów podrzędnych — ESC + przyciski „Wróć”.
 * Handlery rejestruj w kolejności priorytetu (najwyższy pierwszy).
 */
export type UiBackHandler = () => boolean;

const handlers: UiBackHandler[] = [];

export function registerUiBackHandler(handler: UiBackHandler): void {
	handlers.push(handler);
}

/** Zwraca true gdy jakiś ekran został zamknięty. */
export function tryUiNavigateBack(): boolean {
	for (const handler of handlers) {
		if (handler()) return true;
	}
	return false;
}

export function clearUiBackHandlers(): void {
	handlers.length = 0;
}
