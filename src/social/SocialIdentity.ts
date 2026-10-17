const SOCIAL_ID_KEY = "ignite.social.id.v1";
const INVITE_CODE_KEY = "ignite.social.inviteCode.v1";
const DISPLAY_NAME_KEY = "ignite.social.displayName.v1";

const mem = new Map<string, string>();

function storageGet(key: string): string | null {
	try {
		if (typeof localStorage !== "undefined") {
			const v = localStorage.getItem(key);
			if (v != null) {
				mem.set(key, v);
				return v;
			}
		}
	} catch {
		/* */
	}
	return mem.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
	mem.set(key, value);
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(key, value);
		}
	} catch {
		/* */
	}
}

function storageRemove(key: string): void {
	mem.delete(key);
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.removeItem(key);
		}
	} catch {
		/* */
	}
}

function randomUuid(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `s_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/** Krótki kod zaproszenia: IGN-XXXX (A-Z0-9). */
export function generateInviteCode(seed?: string): string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let n = 0;
	const src = seed ?? randomUuid();
	for (let i = 0; i < src.length; i++) n = (n * 31 + src.charCodeAt(i)) >>> 0;
	let out = "";
	for (let i = 0; i < 4; i++) {
		out += alphabet[(n + i * 17) % alphabet.length]!;
		n = (n * 1103515245 + 12345) >>> 0;
	}
	return `IGN-${out}`;
}

export function normalizeInviteCode(raw: string): string {
	const cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
	if (cleaned.startsWith("IGN-")) return cleaned;
	if (/^[A-Z0-9]{4}$/.test(cleaned)) return `IGN-${cleaned}`;
	return cleaned;
}

export function getSocialId(): string {
	let id = storageGet(SOCIAL_ID_KEY);
	if (!id) {
		id = randomUuid();
		storageSet(SOCIAL_ID_KEY, id);
	}
	return id;
}

export function getInviteCode(): string {
	let code = storageGet(INVITE_CODE_KEY);
	if (!code) {
		code = generateInviteCode(getSocialId());
		storageSet(INVITE_CODE_KEY, code);
	}
	return normalizeInviteCode(code);
}

export function getSocialDisplayName(): string {
	const name = storageGet(DISPLAY_NAME_KEY)?.trim();
	if (name) return name.slice(0, 24);
	return "Player";
}

export function setSocialDisplayName(name: string): void {
	const cleaned = name.trim().slice(0, 24) || "Player";
	storageSet(DISPLAY_NAME_KEY, cleaned);
}

/** Testy — reset pamięci. */
export function resetSocialIdentityForTests(): void {
	storageRemove(SOCIAL_ID_KEY);
	storageRemove(INVITE_CODE_KEY);
	storageRemove(DISPLAY_NAME_KEY);
}
