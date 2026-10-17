#!/usr/bin/env node
/**
 * Tworzy #musix (STAFF, Admin-only) + VC Musix (GLOS, Admin-only)
 * i zapisuje ID w ~/.config/ignite/discord-server.json
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://discord.com/api/v10";
const ENV_FILE = join(homedir(), ".config/ignite/discord.env");
const META_FILE = join(homedir(), ".config/ignite/discord-server.json");

const PERM = {
	viewChannel: 1n << 10n,
	sendMessages: 1n << 11n,
	manageMessages: 1n << 13n,
	embedLinks: 1n << 14n,
	attachFiles: 1n << 15n,
	readHistory: 1n << 16n,
	connect: 1n << 20n,
	speak: 1n << 21n,
};

const MUSIX_HELP = `**Now Playing — Ignite**
Wklej link YouTube (albo \`!play <url>\`) → bot gra na VC **Musix**.

Na kanale wisi live board: **▶ Teraz gra** + kolejka (kto / kiedy / co).

\`!queue\` · \`!skip\` · \`!np\` · \`!stop\``;

function publicTextOverwrites(everyoneId, adminRoleId) {
	return [
		{
			id: everyoneId,
			type: 0,
			allow: (
				PERM.viewChannel |
				PERM.sendMessages |
				PERM.readHistory |
				PERM.embedLinks
			).toString(),
		},
		{
			id: adminRoleId,
			type: 0,
			allow: (
				PERM.viewChannel |
				PERM.sendMessages |
				PERM.readHistory |
				PERM.manageMessages |
				PERM.embedLinks |
				PERM.attachFiles
			).toString(),
		},
	];
}

function listenVoiceOverwrites(everyoneId, adminRoleId) {
	return [
		{
			id: everyoneId,
			type: 0,
			allow: (PERM.viewChannel | PERM.connect).toString(),
			deny: PERM.speak.toString(),
		},
		{
			id: adminRoleId,
			type: 0,
			allow: (
				PERM.viewChannel |
				PERM.connect |
				PERM.speak
			).toString(),
		},
	];
}

function loadEnv() {
	if (!existsSync(ENV_FILE)) {
		console.error(`Brak ${ENV_FILE}`);
		process.exit(1);
	}
	const out = {};
	for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const i = t.indexOf("=");
		if (i < 0) continue;
		out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
	}
	if (!out.DISCORD_BOT_TOKEN) {
		console.error("Brak DISCORD_BOT_TOKEN");
		process.exit(1);
	}
	return out;
}

function loadMeta() {
	if (!existsSync(META_FILE)) return {};
	try {
		return JSON.parse(readFileSync(META_FILE, "utf8"));
	} catch {
		return {};
	}
}

function saveMeta(meta) {
	mkdirSync(join(homedir(), ".config/ignite"), { recursive: true, mode: 0o700 });
	writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
}

function api(token, path, opts = {}) {
	return fetch(`${API}${path}`, {
		...opts,
		headers: {
			Authorization: `Bot ${token}`,
			"Content-Type": "application/json",
			...(opts.headers ?? {}),
		},
	}).then(async (res) => {
		const text = await res.text();
		let data = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = text;
		}
		if (!res.ok) {
			throw new Error(
				`${opts.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(data)}`,
			);
		}
		return data;
	});
}

async function sleep(ms) {
	await new Promise((r) => setTimeout(r, ms));
}

function adminTextOverwrites(everyoneId, adminRoleId) {
	return [
		{
			id: everyoneId,
			type: 0,
			deny: PERM.viewChannel.toString(),
		},
		{
			id: adminRoleId,
			type: 0,
			allow: (
				PERM.viewChannel |
				PERM.sendMessages |
				PERM.readHistory |
				PERM.manageMessages |
				PERM.embedLinks |
				PERM.attachFiles
			).toString(),
		},
	];
}

function adminVoiceOverwrites(everyoneId, adminRoleId) {
	return [
		{
			id: everyoneId,
			type: 0,
			deny: (PERM.viewChannel | PERM.connect).toString(),
		},
		{
			id: adminRoleId,
			type: 0,
			allow: (
				PERM.viewChannel |
				PERM.connect |
				PERM.speak
			).toString(),
		},
	];
}

async function ensureCategory(guildId, token, name, existing) {
	const found = existing.find((c) => c.type === 4 && c.name === name);
	if (found) return found.id;
	const ch = await api(token, `/guilds/${guildId}/channels`, {
		method: "POST",
		body: JSON.stringify({ name, type: 4 }),
	});
	console.log(`  + kategoria ${name}`);
	await sleep(350);
	return ch.id;
}

async function ensureChannel(guildId, token, spec, existing) {
	const found = existing.find(
		(c) =>
			c.name === spec.name &&
			c.type === (spec.type ?? 0) &&
			(c.parent_id ?? null) === (spec.parent_id ?? null),
	);
	if (found) {
		/** Odśwież overwrites jeśli podane. */
		if (spec.permission_overwrites) {
			await api(token, `/channels/${found.id}`, {
				method: "PATCH",
				body: JSON.stringify({
					permission_overwrites: spec.permission_overwrites,
				}),
			});
			console.log(`  #${spec.name} już jest — zaktualizowano overwrites`);
		} else {
			console.log(`  #${spec.name} już jest`);
		}
		return found.id;
	}
	const ch = await api(token, `/guilds/${guildId}/channels`, {
		method: "POST",
		body: JSON.stringify(spec),
	});
	console.log(`  + #${spec.name}`);
	await sleep(350);
	return ch.id;
}

async function sendAndPin(token, channelId, content) {
	const pins = await api(token, `/channels/${channelId}/pins`);
	if (
		pins.some((p) =>
			String(p.content ?? "").includes("Now Playing — Ignite"),
		)
	) {
		console.log("  pin Now Playing już jest");
		return;
	}
	const msg = await api(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({ content }),
	});
	await api(token, `/channels/${channelId}/pins/${msg.id}`, { method: "PUT" });
	await sleep(350);
	console.log("  + pin instrukcji Now Playing");
}

async function main() {
	const env = loadEnv();
	const token = env.DISCORD_BOT_TOKEN;
	const meta = loadMeta();
	const guildId =
		env.DISCORD_GUILD_ID || meta.guildId || "1530332650924019953";

	const guild = await api(token, `/guilds/${guildId}`);
	const everyone = guildId;
	const roles = await api(token, `/guilds/${guildId}/roles`);
	const adminRole = roles.find((r) => r.name === "Admin");
	if (!adminRole) {
		console.error('Brak roli "Admin" — uruchom najpierw discord-setup-server.mjs');
		process.exit(1);
	}

	let channels = await api(token, `/guilds/${guildId}/channels`);
	console.log(`== Musix / Now Playing ensure: ${guild.name} (${guildId}) ==`);

	const catNow = await ensureCategory(guildId, token, "NOW PLAYING", channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catStaff = await ensureCategory(guildId, token, "STAFF", channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catVoice = await ensureCategory(guildId, token, "GLOS", channels);
	channels = await api(token, `/guilds/${guildId}/channels`);

	const chNowPlaying = await ensureChannel(
		guildId,
		token,
		{
			name: "now-playing",
			type: 0,
			parent_id: catNow,
			topic: "Wklej YouTube → gra na VC Musix · live ▶ Teraz gra",
			permission_overwrites: publicTextOverwrites(everyone, adminRole.id),
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);

	const chMusix = await ensureChannel(
		guildId,
		token,
		{
			name: "musix",
			type: 0,
			parent_id: catStaff,
			topic: "Admin Musix — awaryjne sterowanie",
			permission_overwrites: adminTextOverwrites(everyone, adminRole.id),
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);

	const chMusixVoice = await ensureChannel(
		guildId,
		token,
		{
			name: "Musix",
			type: 2,
			parent_id: catVoice,
			permission_overwrites: listenVoiceOverwrites(everyone, adminRole.id),
		},
		channels,
	);

	await sendAndPin(token, chNowPlaying, MUSIX_HELP);

	const next = {
		...meta,
		guildId,
		name: guild.name || meta.name || "Ignite",
		clientId: env.DISCORD_CLIENT_ID || meta.clientId,
		channels: {
			...(meta.channels ?? {}),
			nowPlaying: chNowPlaying,
			musix: chMusix,
			musixVoice: chMusixVoice,
		},
	};
	saveMeta(next);

	if (!env.DISCORD_GUILD_ID) {
		let text = readFileSync(ENV_FILE, "utf8");
		if (/^DISCORD_GUILD_ID=/m.test(text)) {
			text = text.replace(/^DISCORD_GUILD_ID=.*$/m, `DISCORD_GUILD_ID=${guildId}`);
		} else {
			text = text.trimEnd() + `\nDISCORD_GUILD_ID=${guildId}\n`;
		}
		writeFileSync(ENV_FILE, text, { mode: 0o600 });
	}

	console.log(`
✅ Now Playing gotowe
  #now-playing  ${chNowPlaying}
  #musix        ${chMusix}
  VC Musix      ${chMusixVoice}
  meta → ${META_FILE}
`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
