import { en } from "./locales/en";
import { pl } from "./locales/pl";

export type Locale = "pl" | "en";
export type I18nKey = keyof typeof pl;

const STORAGE_KEY = "ignite-locale";

const messages: Record<Locale, Record<I18nKey, string>> = { pl, en };

let currentLocale: Locale = "pl";
const listeners = new Set<() => void>();

export function initI18n(): Locale {
	if (typeof window === "undefined") {
		return currentLocale;
	}

	const params = new URLSearchParams(window.location.search);
	const urlLang = params.get("lang");
	if (urlLang === "pl" || urlLang === "en") {
		currentLocale = urlLang;
		try {
			localStorage.setItem(STORAGE_KEY, urlLang);
		} catch {
			/* ignore */
		}
	} else {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored === "pl" || stored === "en") {
				currentLocale = stored;
			} else {
				const nav = navigator.language.toLowerCase();
				currentLocale = nav.startsWith("pl") ? "pl" : "en";
			}
		} catch {
			const nav = navigator.language.toLowerCase();
			currentLocale = nav.startsWith("pl") ? "pl" : "en";
		}
	}
	if (typeof document !== "undefined" && document.documentElement) {
		document.documentElement.lang = currentLocale;
	}
	return currentLocale;
}

export function getLocale(): Locale {
	return currentLocale;
}

export function setLocale(locale: Locale): void {
	if (locale === currentLocale) return;
	currentLocale = locale;
	if (typeof document !== "undefined" && document.documentElement) {
		document.documentElement.lang = locale;
	}
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		/* ignore */
	}
	for (const fn of listeners) fn();
}

export function onLocaleChange(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export function t(
	key: I18nKey,
	params?: Record<string, string | number>,
): string {
	let text = messages[currentLocale][key] ?? messages.en[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
		}
	}
	return text;
}

/** Polish: one / few (2–4, not teens) / many. English: one / other. */
export function pluralForm(
	count: number,
	forms: { one: I18nKey; few: I18nKey; many: I18nKey },
): I18nKey {
	if (currentLocale === "en") {
		return count === 1 ? forms.one : forms.many;
	}
	const mod10 = count % 10;
	const mod100 = count % 100;
	if (count === 1) return forms.one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return forms.few;
	}
	return forms.many;
}
