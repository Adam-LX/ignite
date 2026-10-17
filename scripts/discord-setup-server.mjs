#!/usr/bin/env node
/**
 * Tworzy / konfiguruje serwer Discord „Ignite”.
 * Wymaga: bot z uprawnieniem Administrator (lub 0 guilds → bot tworzy serwer).
 *
 * ~/.config/ignite/discord.env:
 *   DISCORD_BOT_TOKEN=...
 *   DISCORD_CLIENT_ID=...   (opcjonalnie — invite)
 *   DISCORD_GUILD_ID=...    (opcjonalnie — inaczej pierwszy / nowy)
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://discord.com/api/v10";
const ENV_FILE = join(homedir(), ".config/ignite/discord.env");
const SERVER_NAME = "Ignite";

const PERM = {
	viewChannel: 1n << 10n,
	sendMessages: 1n << 11n,
	readHistory: 1n << 16n,
	manageMessages: 1n << 13n,
	kick: 1n << 1n,
	ban: 1n << 2n,
	manageChannels: 1n << 4n,
	manageRoles: 1n << 28n,
	moderateMembers: 1n << 40n,
	manageThreads: 1n << 34n,
	createPublicThreads: 1n << 18n,
	sendMessagesInThreads: 1n << 38n,
	viewAuditLog: 1n << 7n,
	manageEvents: 1n << 33n,
	connect: 1n << 20n,
	speak: 1n << 21n,
	attachFiles: 1n << 15n,
	embedLinks: 1n << 14n,
	addReactions: 1n << 6n,
};

const MOD_PERMS =
	PERM.viewChannel |
	PERM.sendMessages |
	PERM.readHistory |
	PERM.manageMessages |
	PERM.kick |
	PERM.moderateMembers |
	PERM.manageThreads |
	PERM.viewAuditLog;

const ADMIN_PERMS =
	MOD_PERMS | PERM.ban | PERM.manageChannels | PERM.manageRoles | PERM.manageEvents;

function loadEnv() {
	if (!existsSync(ENV_FILE)) {
		console.error(`Brak ${ENV_FILE}`);
		console.error("Uruchom: bash scripts/discord-server-bootstrap.sh");
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
		console.error("Brak DISCORD_BOT_TOKEN w discord.env");
		process.exit(1);
	}
	return out;
}

function saveGuildId(guildId) {
	let text = readFileSync(ENV_FILE, "utf8");
	if (/^DISCORD_GUILD_ID=/m.test(text)) {
		text = text.replace(/^DISCORD_GUILD_ID=.*$/m, `DISCORD_GUILD_ID=${guildId}`);
	} else {
		text = text.trimEnd() + `\nDISCORD_GUILD_ID=${guildId}\n`;
	}
	writeFileSync(ENV_FILE, text, { mode: 0o600 });
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

async function findOrCreateRole(guildId, token, name, color, permissions) {
	const roles = await api(token, `/guilds/${guildId}/roles`);
	const existing = roles.find((r) => r.name === name);
	if (existing) {
		console.log(`  rola "${name}" już jest (${existing.id})`);
		return existing.id;
	}
	const role = await api(token, `/guilds/${guildId}/roles`, {
		method: "POST",
		body: JSON.stringify({
			name,
			color,
			permissions: permissions.toString(),
			hoist: name === "Admin" || name === "Mod",
			mentionable: name === "Ogłoszenia" || name === "Ignite",
		}),
	});
	console.log(`  + rola ${name}`);
	await sleep(350);
	return role.id;
}

async function ensureCategory(guildId, token, name, position, existing) {
	const found = existing.find((c) => c.type === 4 && c.name === name);
	if (found) {
		console.log(`  kategoria "${name}" już jest`);
		return found.id;
	}
	const ch = await api(token, `/guilds/${guildId}/channels`, {
		method: "POST",
		body: JSON.stringify({ name, type: 4, position }),
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
		console.log(`  #${spec.name} już jest`);
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
	if (pins.length > 0) {
		console.log(`  pin już jest na kanale ${channelId}`);
		return;
	}
	const msg = await api(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({ content }),
	});
	await api(token, `/channels/${channelId}/pins/${msg.id}`, { method: "PUT" });
	await sleep(350);
}

function denySend(everyoneId) {
	return {
		id: everyoneId,
		type: 0,
		deny: (
			PERM.sendMessages |
			PERM.createPublicThreads |
			PERM.sendMessagesInThreads
		).toString(),
		allow: (PERM.viewChannel | PERM.readHistory).toString(),
	};
}

function staffOnly(roleIds) {
	return roleIds.map((id) => ({
		id,
		type: 0,
		allow: (
			PERM.viewChannel |
			PERM.sendMessages |
			PERM.readHistory |
			PERM.manageMessages
		).toString(),
	}));
}

function adminOnlyText(everyoneId, adminRoleId) {
	return [
		{ id: everyoneId, type: 0, deny: PERM.viewChannel.toString() },
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

function adminOnlyVoice(everyoneId, adminRoleId) {
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

async function createGuildIfNeeded(token, guildIdEnv) {
	const guilds = await api(token, "/users/@me/guilds");

	if (guildIdEnv) {
		const hit = guilds.find((g) => g.id === guildIdEnv);
		if (!hit) {
			console.error(`DISCORD_GUILD_ID=${guildIdEnv} — bot nie jest na tym serwerze`);
			process.exit(1);
		}
		return guildIdEnv;
	}

	const named = guilds.find((g) => g.name === SERVER_NAME);
	if (named) {
		console.log(`Używam istniejącego serwera „${SERVER_NAME}” (${named.id})`);
		return named.id;
	}

	if (guilds.length === 1) {
		console.log(`Używam jedynego serwera bota: ${guilds[0].name} (${guilds[0].id})`);
		return guilds[0].id;
	}

	if (guilds.length > 1) {
		console.error("Bot na wielu serwerach — ustaw DISCORD_GUILD_ID w discord.env:");
		for (const g of guilds) console.error(`  ${g.id}  ${g.name}`);
		process.exit(1);
	}

	/** 0 guilds → bot tworzy serwer (limit Discord: bot < 10 serwerów). */
	console.log(`Tworzę serwer „${SERVER_NAME}”…`);
	const guild = await api(token, "/guilds", {
		method: "POST",
		body: JSON.stringify({
			name: SERVER_NAME,
			/* region deprecated — Discord wybierze automatycznie */
		}),
	});
	console.log(`  + guild ${guild.id}`);
	saveGuildId(guild.id);
	await sleep(1500);
	return guild.id;
}

async function createInvite(token, channelId) {
	const inv = await api(token, `/channels/${channelId}/invites`, {
		method: "POST",
		body: JSON.stringify({
			max_age: 0,
			max_uses: 0,
			unique: true,
		}),
	});
	return `https://discord.gg/${inv.code}`;
}

async function main() {
	const env = loadEnv();
	const token = env.DISCORD_BOT_TOKEN;
	const clientId = env.DISCORD_CLIENT_ID || "";

	const me = await api(token, "/users/@me");
	console.log(`Bot: ${me.username} (${me.id})`);

	const guildId = await createGuildIfNeeded(token, env.DISCORD_GUILD_ID || "");
	saveGuildId(guildId);

	const guild = await api(token, `/guilds/${guildId}`);
	if (guild.name !== SERVER_NAME) {
		try {
			await api(token, `/guilds/${guildId}`, {
				method: "PATCH",
				body: JSON.stringify({ name: SERVER_NAME }),
			});
			console.log(`  przemianowano → ${SERVER_NAME}`);
		} catch (e) {
			console.warn(`  nie udało się zmienić nazwy: ${e.message}`);
		}
	}

	console.log(`\n== Setup: ${SERVER_NAME} (${guildId}) ==\n`);

	console.log("Role…");
	const roleIgnite = await findOrCreateRole(guildId, token, "Ignite", 0xe85d04, 0n);
	const roleNews = await findOrCreateRole(guildId, token, "Ogłoszenia", 0xf1c40f, 0n);
	const roleBeta = await findOrCreateRole(guildId, token, "Beta", 0x9b59b6, 0n);
	const roleMod = await findOrCreateRole(guildId, token, "Mod", 0x2ecc71, MOD_PERMS);
	const roleAdmin = await findOrCreateRole(guildId, token, "Admin", 0xe74c3c, ADMIN_PERMS);
	void roleNews;
	void roleBeta;
	void roleIgnite;

	const everyone = guildId;
	let channels = await api(token, `/guilds/${guildId}/channels`);

	console.log("\nKanały…");
	const catInfo = await ensureCategory(guildId, token, "INFO", 0, channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catChat = await ensureCategory(guildId, token, "CZAT", 1, channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catGame = await ensureCategory(guildId, token, "IGNITE", 2, channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catVoice = await ensureCategory(guildId, token, "GLOS", 3, channels);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const catStaff = await ensureCategory(guildId, token, "STAFF", 4, channels);
	channels = await api(token, `/guilds/${guildId}/channels`);

	const rulesContent = `**ZASADY — Ignite**
1. Szacunek — bez personalnych ataków i dyskryminacji
2. Bez spamu, reklam i pingów @everyone bez powodu
3. NSFW tylko na oznaczonych kanałach — domyślnie nie
4. Voice: bez earrape / soundboard spam
5. Spory → DM do **Mod** / **Admin**, nie dramat na publicznym
6. Doxx, cheaty, groźby → ban
7. Spojlery patchy trzymaj w wątkach albo pod spoilerem

Kary: ostrzeżenie → mute → kick → ban`;

	const welcomeContent = `**Witaj w Ignite** 🔥

Browser / Electron arena — piłka, auta, boost.

1. Przeczytaj <#CHANNEL_RULES>
2. Weź rolę **Ignite** (od admina / w przyszłości self-role)
3. Gadaj na kanale ogólnym albo LFG

Linki pojawią się w <#CHANNEL_LINKS> gdy będzie build publiczny.`;

	const announceContent = `**Serwer Ignite online**

• Zasady → kanał zasad
• Patch notes / buildy → #patch-notes
• Bugi → #bugi
• LFG / mecz → #lfg

Pinguj rolę **Ogłoszenia**, jeśli chcesz dostać powiadomienie o releasach.`;

	const linksContent = `**Linki**
• Gra / build: _(wkrótce)_
• Feedback: #bugi + #pomysly
• Owner nie musi siedzieć 24/7 — pisz do **Admin** / **Mod**`;

	const chPowitanie = await ensureChannel(
		guildId,
		token,
		{
			name: "powitanie",
			type: 0,
			parent_id: catInfo,
			topic: "Start tutaj",
			permission_overwrites: [denySend(everyone)],
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const chZasady = await ensureChannel(
		guildId,
		token,
		{
			name: "zasady",
			type: 0,
			parent_id: catInfo,
			permission_overwrites: [denySend(everyone)],
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const chOgloszenia = await ensureChannel(
		guildId,
		token,
		{
			name: "ogloszenia",
			type: 0,
			parent_id: catInfo,
			permission_overwrites: [denySend(everyone)],
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const chLinki = await ensureChannel(
		guildId,
		token,
		{
			name: "linki",
			type: 0,
			parent_id: catInfo,
			permission_overwrites: [denySend(everyone)],
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "ogolne", type: 0, parent_id: catChat, topic: "Luźny czat" },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "memy", type: 0, parent_id: catChat, topic: "Obrazki / shitpost (bez NSFW)" },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{
			name: "lfg",
			type: 0,
			parent_id: catGame,
			topic: "Looking for game — 1v1 / 2v2 / custom",
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{
			name: "patch-notes",
			type: 0,
			parent_id: catGame,
			topic: "Changelog i buildy",
			permission_overwrites: [denySend(everyone)],
		},
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "bugi", type: 0, parent_id: catGame, topic: "Repro: OS, build, kroki" },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "pomysly", type: 0, parent_id: catGame, topic: "Feature requests" },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "screenshoty", type: 0, parent_id: catGame, topic: "Clipy / screeny z meczu i garażu" },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "Lobby", type: 2, parent_id: catVoice },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "Mecz-1", type: 2, parent_id: catVoice },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	await ensureChannel(
		guildId,
		token,
		{ name: "Mecz-2", type: 2, parent_id: catVoice },
		channels,
	);
	channels = await api(token, `/guilds/${guildId}/channels`);
	const chMod = await ensureChannel(
		guildId,
		token,
		{
			name: "mod-chat",
			type: 0,
			parent_id: catStaff,
			permission_overwrites: [
				{ id: everyone, type: 0, deny: PERM.viewChannel.toString() },
				...staffOnly([roleMod, roleAdmin]),
			],
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
			topic: "Kolejka muzyki Admin — YouTube links / !play",
			permission_overwrites: adminOnlyText(everyone, roleAdmin),
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
			permission_overwrites: adminOnlyVoice(everyone, roleAdmin),
		},
		channels,
	);

	console.log("\nWiadomości + pin…");
	await sendAndPin(
		token,
		chPowitanie,
		welcomeContent
			.replace("<#CHANNEL_RULES>", `<#${chZasady}>`)
			.replace("<#CHANNEL_LINKS>", `<#${chLinki}>`),
	);
	await sendAndPin(token, chZasady, rulesContent);
	await sendAndPin(token, chOgloszenia, announceContent);
	await sendAndPin(token, chLinki, linksContent);
	await sendAndPin(
		token,
		chMusix,
		`**Musix — kolejka Admin**
Wklej link YouTube albo \`!play <url>\` — bot zagra na VC **Musix**.

\`!queue\` — lista · \`!skip\` — następny · \`!np\` — teraz · \`!stop\` — stop + wyczyść

Bot: \`bash scripts/discord-musix-run.sh\``,
	);
	await api(token, `/channels/${chMod}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content: "Kanał staff — logi, spory, ustalenia. Owner nie musi tu być 24/7.",
		}),
	});

	channels = await api(token, `/guilds/${guildId}/channels`);
	for (const c of channels) {
		if (
			c.type === 0 &&
			!c.parent_id &&
			(c.name === "general" ||
				c.name === "ogólny" ||
				c.name === "ogolny" ||
				c.name === "General")
		) {
			try {
				await api(token, `/channels/${c.id}`, { method: "DELETE" });
				console.log(`  - usunięto stary #${c.name}`);
			} catch {
				/* ignore */
			}
		}
	}

	let inviteUrl = "";
	try {
		inviteUrl = await createInvite(token, chPowitanie);
	} catch (e) {
		console.warn(`Invite: ${e.message}`);
	}

	const botInvite = clientId
		? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`
		: "(ustaw DISCORD_CLIENT_ID dla linku bota)";

	try {
		const metaPath = join(homedir(), ".config/ignite/discord-server.json");
		let meta = {};
		if (existsSync(metaPath)) {
			try {
				meta = JSON.parse(readFileSync(metaPath, "utf8"));
			} catch {
				meta = {};
			}
		}
		meta = {
			...meta,
			guildId,
			name: SERVER_NAME,
			clientId: clientId || meta.clientId,
			invite: inviteUrl || meta.invite,
			channels: {
				...(meta.channels ?? {}),
				musix: chMusix,
				musixVoice: chMusixVoice,
			},
		};
		writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, {
			mode: 0o600,
		});
		console.log(`  meta → ${metaPath}`);
	} catch (e) {
		console.warn(`  meta save: ${e.message}`);
	}

	console.log(`
✅ Serwer Ignite gotowy.

Guild ID: ${guildId}
Invite:   ${inviteUrl || "(brak — stwórz ręcznie z #powitanie)"}
Bot invite (na inne serwery): ${botInvite}
Musix:    #musix + VC Musix (Admin-only)

Owner:
  • Nadaj Admin 1–2 osobom
  • Wrzuć ikonę serwera (np. public/assets/ignite_logo.png)
  • Rola Ignite / Beta — ręcznie albo self-role później
  • Musix bot: bash scripts/discord-musix-run.sh (+ Message Content Intent)
`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
