#!/usr/bin/env node
/**
 * Automatyczny setup serwera Discord (role, kanały, zasady).
 * Wymaga: bot z uprawnieniem Administrator na serwerze.
 *
 * ~/.config/ignite/discord.env:
 *   DISCORD_BOT_TOKEN=...
 *   DISCORD_GUILD_ID=...   (opcjonalnie — inaczej pierwszy serwer bota)
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://discord.com/api/v10";
const ENV_FILE = join(homedir(), ".config/ignite/discord.env");

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
			throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${JSON.stringify(data)}`);
		}
		return data;
	});
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
		}),
	});
	console.log(`  + rola ${name}`);
	return role.id;
}

async function createCategory(guildId, token, name, position) {
	const ch = await api(token, `/guilds/${guildId}/channels`, {
		method: "POST",
		body: JSON.stringify({ name, type: 4, position }),
	});
	console.log(`  + kategoria ${name}`);
	return ch.id;
}

async function createChannel(guildId, token, spec) {
	const ch = await api(token, `/guilds/${guildId}/channels`, {
		method: "POST",
		body: JSON.stringify(spec),
	});
	console.log(`  + #${spec.name}`);
	return ch.id;
}

async function sendAndPin(token, channelId, content) {
	const msg = await api(token, `/channels/${channelId}/messages`, {
		method: "POST",
		body: JSON.stringify({ content }),
	});
	await api(token, `/channels/${channelId}/pins/${msg.id}`, { method: "PUT" });
}

function denySend(overwrite) {
	return {
		id: overwrite,
		type: 0,
		deny: (PERM.sendMessages | PERM.createPublicThreads | PERM.sendMessagesInThreads).toString(),
		allow: (PERM.viewChannel | PERM.readHistory).toString(),
	};
}

function staffOnly(overwrite, allowIds) {
	return allowIds.map((id) => ({
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

async function main() {
	const { DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildIdEnv } = loadEnv();

	const me = await api(token, "/users/@me");
	console.log(`Bot: ${me.username}`);

	let guildId = guildIdEnv;
	if (!guildId) {
		const guilds = await api(token, "/users/@me/guilds");
		if (guilds.length === 0) {
			console.error("Bot nie jest na żadnym serwerze. Zaproś go linkiem z bootstrap.sh");
			process.exit(1);
		}
		if (guilds.length > 1) {
			console.error("Bot na wielu serwerach — ustaw DISCORD_GUILD_ID w discord.env");
			for (const g of guilds) console.error(`  ${g.id}  ${g.name}`);
			process.exit(1);
		}
		guildId = guilds[0].id;
	}

	const guild = await api(token, `/guilds/${guildId}`);
	console.log(`\n== Setup: ${guild.name} (${guildId}) ==\n`);

	console.log("Role…");
	const roleIgnite = await findOrCreateRole(guildId, token, "Ignite", 0xe85d04, 0n);
	const roleNews = await findOrCreateRole(guildId, token, "Ogłoszenia", 0xf1c40f, 0n);
	const roleMod = await findOrCreateRole(guildId, token, "Mod", 0x2ecc71, MOD_PERMS);
	const roleAdmin = await findOrCreateRole(guildId, token, "Admin", 0xe74c3c, ADMIN_PERMS);

	const everyone = guildId;

	console.log("\nKanały…");
	const catInfo = await createCategory(guildId, token, "INFO", 0);
	const catChat = await createCategory(guildId, token, "CZAT", 1);
	const catVoice = await createCategory(guildId, token, "GLOS", 2);
	const catStaff = await createCategory(guildId, token, "STAFF", 3);

	const rulesContent = `**ZASADY**
1. Szacunek — bez personalnych ataków i dyskryminacji
2. Bez spamu, reklam i pingów @everyone bez powodu
3. NSFW tylko na oznaczonych kanałach — domyślnie nie
4. Voice: bez earrape / soundboard spam
5. Spory → DM lub mod, nie dramat na publicznym czacie
6. Doxx, cheaty, groźby → ban

Kary: ostrzeżenie → mute → kick → ban`;

	const welcomeContent = `Witaj 👋

1. Przeczytaj #zasady
2. Napisz coś na #ogolne
3. Grasz w Ignite? Poproś admina o rolę **Ignite**

Admini ogarniają serwer — nie musisz pisać do ownera przy każdym problemie.`;

	const announceContent = `Serwer skonfigurowany automatycznie 🤖

• Zasady → #zasady
• Gadanie → #ogolne
• Ignite / LFG → #ignite

Owner może być w tle — pinguj **Admin** / **Mod**.`;

	const chPowitanie = await createChannel(guildId, token, {
		name: "powitanie",
		type: 0,
		parent_id: catInfo,
		topic: "Start tutaj",
		permission_overwrites: [denySend(everyone)],
	});
	const chZasady = await createChannel(guildId, token, {
		name: "zasady",
		type: 0,
		parent_id: catInfo,
		permission_overwrites: [denySend(everyone)],
	});
	const chOgloszenia = await createChannel(guildId, token, {
		name: "ogloszenia",
		type: 0,
		parent_id: catInfo,
		permission_overwrites: [denySend(everyone)],
	});
	const chOgolne = await createChannel(guildId, token, {
		name: "ogolne",
		type: 0,
		parent_id: catChat,
	});
	const chIgnite = await createChannel(guildId, token, {
		name: "ignite",
		type: 0,
		parent_id: catChat,
		topic: "LFG, buildy, bugi Ignite",
	});
	await createChannel(guildId, token, {
		name: "Lobby",
		type: 2,
		parent_id: catVoice,
	});
	await createChannel(guildId, token, {
		name: "Gra-1",
		type: 2,
		parent_id: catVoice,
	});
	await createChannel(guildId, token, {
		name: "Gra-2",
		type: 2,
		parent_id: catVoice,
	});
	const chMod = await createChannel(guildId, token, {
		name: "mod-chat",
		type: 0,
		parent_id: catStaff,
		permission_overwrites: [
			{
				id: everyone,
				type: 0,
				deny: PERM.viewChannel.toString(),
			},
			...staffOnly(roleMod, [roleMod, roleAdmin]),
		],
	});

	console.log("\nWiadomości + pin…");
	await sendAndPin(token, chPowitanie, welcomeContent);
	await sendAndPin(token, chZasady, rulesContent);
	await sendAndPin(token, chOgloszenia, announceContent);
	await api(token, `/channels/${chMod}/messages`, {
		method: "POST",
		body: JSON.stringify({
			content: "Kanał staff — logi, spory, ustalenia. Owner nie musi tu być.",
		}),
	});

	// Usuń domyślny #general / #ogólny jeśli istnieje
	const channels = await api(token, `/guilds/${guildId}/channels`);
	for (const c of channels) {
		if (
			c.type === 0 &&
			!c.parent_id &&
			(c.name === "general" || c.name === "ogólny" || c.name === "ogolny")
		) {
			try {
				await api(token, `/channels/${c.id}`, { method: "DELETE" });
				console.log(`  - usunięto stary #${c.name}`);
			} catch {
				/* ignore */
			}
		}
	}

	console.log(`
✅ Gotowe.

Ty (owner):
  • Nadaj role Admin 1–2 kumplom: Ustawienia → Członkowie
  • Nie musisz być aktywny na #ogloszenia — admini ogarniają
  • Za tydzień możesz przekazać własność: Członkowie → … → Przekaż własność

Role utworzone: Ignite, Ogłoszenia, Mod, Admin
`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
