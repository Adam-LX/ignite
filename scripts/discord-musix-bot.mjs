#!/usr/bin/env node
/**
 * Ignite Musix — kolejka YouTube na VC Musix (tylko #musix + rola Admin).
 *
 * Live playlista (pin): kto / kiedy / co + podświetlenie aktualnego utworu.
 *
 * Start:
 *   1) Discord Developer Portal → Bot → Reset Token + Message Content Intent ON
 *   2) bash scripts/discord-musix-set-token.sh
 *   3) bash scripts/discord-musix-run.sh
 *   opcjonalnie: systemctl --user enable --now ignite-musix
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	Client,
	EmbedBuilder,
	GatewayIntentBits,
	Partials,
} from "discord.js";
import {
	AudioPlayerStatus,
	NoSubscriberBehavior,
	VoiceConnectionStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	getVoiceConnection,
	joinVoiceChannel,
	StreamType,
} from "@discordjs/voice";

const ENV_FILE = join(homedir(), ".config/ignite/discord.env");
const META_FILE = join(homedir(), ".config/ignite/discord-server.json");
const YT_RE =
	/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const BOARD_MARKER = "Now Playing — Ignite";
const MAX_QUEUE_LINES = 18;

function loadEnv() {
	const out = {};
	if (existsSync(ENV_FILE)) {
		for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const i = t.indexOf("=");
			if (i < 0) continue;
			out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
		}
	}
	if (process.env.DISCORD_BOT_TOKEN) {
		out.DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
	}
	if (process.env.DISCORD_GUILD_ID) {
		out.DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
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
	writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`, {
		mode: 0o600,
	});
}

function extractYoutubeUrl(text) {
	const m = String(text ?? "").match(YT_RE);
	if (!m) return null;
	return `https://www.youtube.com/watch?v=${m[1]}`;
}

function ytDlpPath() {
	return process.env.YT_DLP || "yt-dlp";
}

function formatDuration(sec) {
	const s = Math.max(0, Math.floor(sec || 0));
	const m = Math.floor(s / 60);
	const r = s % 60;
	return `${m}:${String(r).padStart(2, "0")}`;
}

function truncate(s, n) {
	const t = String(s ?? "");
	return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

async function resolveTrack(url) {
	const bin = ytDlpPath();
	const args = [
		"--no-playlist",
		"--no-warnings",
		"-J",
		"-f",
		"ba/bestaudio/best",
		url,
	];
	const raw = await new Promise((resolve, reject) => {
		const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		p.stdout.on("data", (d) => {
			out += d.toString();
		});
		p.stderr.on("data", (d) => {
			err += d.toString();
		});
		p.on("error", reject);
		p.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(err.trim() || `yt-dlp exit ${code}`));
				return;
			}
			resolve(out);
		});
	});
	const info = JSON.parse(raw);
	return {
		url,
		title: info.title || url,
		duration: Number(info.duration) || 0,
	};
}

function openAudioStream(url) {
	const bin = ytDlpPath();
	const ytdlp = spawn(
		bin,
		[
			"--no-playlist",
			"--no-warnings",
			"-f",
			"ba/bestaudio/best",
			"-o",
			"-",
			url,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	ytdlp.stderr.on("data", () => {});
	ytdlp.on("error", (e) => {
		console.error("[Musix] yt-dlp spawn:", e.message);
	});
	return ytdlp;
}

/**
 * @typedef {{
 *   url: string,
 *   title: string,
 *   duration: number,
 *   requestedBy: string,
 *   requestedAt: number,
 * }} Track
 */

class PlaylistBoard {
	/**
	 * @param {import('discord.js').Client} client
	 * @param {string} channelId
	 * @param {() => object} getMeta
	 * @param {(m: object) => void} setMeta
	 */
	constructor(client, channelId, getMeta, setMeta) {
		this.client = client;
		this.channelId = channelId;
		this.getMeta = getMeta;
		this.setMeta = setMeta;
		/** @type {import('discord.js').Message | null} */
		this.message = null;
		this._refreshing = false;
		this._pending = false;
	}

	trackLine(t, { playing = false, index = null } = {}) {
		const when = `<t:${Math.floor(t.requestedAt / 1000)}:R>`;
		const who = `<@${t.requestedBy}>`;
		const dur = `\`${formatDuration(t.duration)}\``;
		const title = truncate(t.title, 72);
		const link = `[link](${t.url})`;
		if (playing) {
			return `▶ **${title}** ${dur}\n　　${who} · ${when} · ${link}`;
		}
		const n = index == null ? "•" : `${index}.`;
		return `${n} ${title} ${dur} — ${who} · ${when} · ${link}`;
	}

	/**
	 * @param {MusixQueue} queue
	 */
	buildEmbed(queue) {
		const playing = queue.current;
		const lines = [];
		lines.push(
			"**Jak dodać:** wklej link YouTube albo `!play <url>` tutaj",
		);
		lines.push(
			"**Słuchaj:** wejdź na VC **Musix** · Komendy: `!skip` · `!stop` · `!queue` · `!np`",
		);
		lines.push("");

		if (playing) {
			lines.push("### ▶ Teraz gra");
			lines.push(this.trackLine(playing, { playing: true }));
		} else {
			lines.push("### ▶ Teraz gra");
			lines.push("_cisza — wrzuć link_");
		}

		lines.push("");
		lines.push("### 📋 Kolejka");
		if (!queue.tracks.length) {
			lines.push("_pusta_");
		} else {
			queue.tracks.slice(0, MAX_QUEUE_LINES).forEach((t, i) => {
				lines.push(this.trackLine(t, { index: i + 1 }));
			});
			if (queue.tracks.length > MAX_QUEUE_LINES) {
				lines.push(`… +${queue.tracks.length - MAX_QUEUE_LINES}`);
			}
		}

		const color = playing ? 0x2ecc71 : 0x95a5a6;
		return new EmbedBuilder()
			.setTitle(BOARD_MARKER)
			.setColor(color)
			.setDescription(lines.join("\n").slice(0, 4000))
			.setFooter({
				text: `${queue.tracks.length} w kolejce · VC Musix · wklej YT poniżej`,
			})
			.setTimestamp(new Date());
	}

	async ensureMessage(channel) {
		if (this.message) return this.message;
		const meta = this.getMeta();
		const savedId = meta.channels?.musixPlaylistMsg;
		if (savedId) {
			try {
				this.message = await channel.messages.fetch(savedId);
				return this.message;
			} catch {
				/* recreate */
			}
		}
		const embed = new EmbedBuilder()
			.setTitle(BOARD_MARKER)
			.setColor(0x95a5a6)
			.setDescription("_start…_");
		this.message = await channel.send({ embeds: [embed] });
		try {
			await this.message.pin();
		} catch {
			/* ignore pin limits */
		}
		const next = this.getMeta();
		next.channels = {
			...(next.channels ?? {}),
			musixPlaylistMsg: this.message.id,
		};
		this.setMeta(next);
		return this.message;
	}

	/**
	 * @param {MusixQueue} queue
	 */
	async refresh(queue) {
		if (this._refreshing) {
			this._pending = true;
			return;
		}
		this._refreshing = true;
		try {
			do {
				this._pending = false;
				const channel = await this.client.channels.fetch(this.channelId);
				if (!channel || !channel.isTextBased()) return;
				const msg = await this.ensureMessage(channel);
				await msg.edit({ embeds: [this.buildEmbed(queue)] });
			} while (this._pending);
		} catch (e) {
			console.error("[Musix] playlist board:", e.message);
		} finally {
			this._refreshing = false;
		}
	}
}

class MusixQueue {
	/**
	 * @param {PlaylistBoard | null} board
	 */
	constructor(board = null) {
		/** @type {Track[]} */
		this.tracks = [];
		/** @type {Track | null} */
		this.current = null;
		/** @type {PlaylistBoard | null} */
		this.board = board;
		this.player = createAudioPlayer({
			behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
		});
		/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
		this.ytdlpProc = null;
		this.player.on(AudioPlayerStatus.Idle, () => {
			this.playNext()
				.then(() => this.board?.refresh(this))
				.catch((e) => console.error("[Musix] playNext:", e));
		});
		this.player.on("error", (e) => {
			console.error("[Musix] player:", e.message);
			this.killStream();
			this.playNext()
				.then(() => this.board?.refresh(this))
				.catch(() => {});
		});
	}

	async bumpBoard() {
		await this.board?.refresh(this);
	}

	killStream() {
		if (this.ytdlpProc && !this.ytdlpProc.killed) {
			try {
				this.ytdlpProc.kill("SIGKILL");
			} catch {
				/* ignore */
			}
		}
		this.ytdlpProc = null;
	}

	enqueue(track) {
		this.tracks.push(track);
	}

	clear() {
		this.tracks = [];
		this.current = null;
		this.killStream();
		this.player.stop(true);
	}

	skip() {
		this.killStream();
		this.player.stop(true);
	}

	async ensureVoice(guild, voiceChannelId) {
		let conn = getVoiceConnection(guild.id);
		if (conn) return conn;
		const channel = await guild.channels.fetch(voiceChannelId);
		if (!channel || channel.type !== 2) {
			throw new Error("Brak VC Musix");
		}
		conn = joinVoiceChannel({
			channelId: channel.id,
			guildId: guild.id,
			adapterCreator: guild.voiceAdapterCreator,
			selfDeaf: true,
		});
		await entersState(conn, VoiceConnectionStatus.Ready, 20_000);
		conn.subscribe(this.player);
		conn.on(VoiceConnectionStatus.Disconnected, async () => {
			try {
				await Promise.race([
					entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
					entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
				]);
			} catch {
				try {
					conn.destroy();
				} catch {
					/* ignore */
				}
			}
		});
		return conn;
	}

	async playNext() {
		this.killStream();
		const next = this.tracks.shift() ?? null;
		this.current = next;
		if (!next) {
			this.player.stop(true);
			return null;
		}
		const proc = openAudioStream(next.url);
		this.ytdlpProc = proc;
		const resource = createAudioResource(proc.stdout, {
			inputType: StreamType.Arbitrary,
			metadata: next,
		});
		this.player.play(resource);
		return next;
	}

	async startIfIdle(guild, voiceChannelId) {
		if (this.player.state.status !== AudioPlayerStatus.Idle) return null;
		if (!this.tracks.length && !this.current) return null;
		await this.ensureVoice(guild, voiceChannelId);
		if (this.current && this.player.state.status !== AudioPlayerStatus.Idle) {
			return this.current;
		}
		return this.playNext();
	}

	queueText() {
		const lines = [];
		if (this.current) {
			lines.push(
				`**▶ Teraz:** ${this.current.title} — <@${this.current.requestedBy}> · <t:${Math.floor(this.current.requestedAt / 1000)}:R>`,
			);
		}
		if (!this.tracks.length) {
			lines.push(this.current ? "_Kolejka pusta._" : "_Nic nie gra._");
			return lines.join("\n");
		}
		lines.push("**Kolejka:**");
		this.tracks.slice(0, 15).forEach((t, i) => {
			lines.push(
				`${i + 1}. ${t.title} — <@${t.requestedBy}> · <t:${Math.floor(t.requestedAt / 1000)}:R>`,
			);
		});
		return lines.join("\n");
	}
}

function memberIsAdmin(member) {
	if (!member) return false;
	if (member.permissions?.has?.("Administrator")) return true;
	return member.roles.cache.some((r) => r.name === "Admin");
}

async function main() {
	const env = loadEnv();
	let meta = loadMeta();
	const token = env.DISCORD_BOT_TOKEN;
	if (!token) {
		console.error(`
Brak DISCORD_BOT_TOKEN.

Zrób tak:
  1) https://discord.com/developers/applications/${meta.clientId || "TWOJE_APP"}/bot
     → Reset Token → skopiuj
     → włącz Message Content Intent → Save
  2) bash scripts/discord-musix-set-token.sh
  3) bash scripts/discord-musix-run.sh
`);
		process.exit(1);
	}

	const guildId = env.DISCORD_GUILD_ID || meta.guildId;
	const boardChannelId = meta.channels?.nowPlaying || meta.channels?.musix;
	const requestChannelIds = new Set(
		[meta.channels?.nowPlaying, meta.channels?.musix].filter(Boolean),
	);
	const musixVoiceId = meta.channels?.musixVoice;
	if (!guildId || !boardChannelId || !musixVoiceId) {
		console.error(
			"Brak guildId / channels.nowPlaying|musix / channels.musixVoice.\nUruchom: node scripts/discord-ensure-musix.mjs",
		);
		process.exit(1);
	}

	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
		],
		partials: [Partials.Channel],
	});

	const board = new PlaylistBoard(
		client,
		boardChannelId,
		() => meta,
		(m) => {
			meta = m;
			saveMeta(m);
		},
	);
	const queue = new MusixQueue(board);

	client.once("ready", async () => {
		console.log(
			`[Musix] zalogowany jako ${client.user.tag} · board=#${boardChannelId} · VC=${musixVoiceId}`,
		);
		await board.refresh(queue);
	});

	client.on("messageCreate", async (msg) => {
		try {
			if (msg.author.bot) return;
			if (msg.guildId !== guildId) return;
			if (!requestChannelIds.has(msg.channelId)) return;

			const isStaffMusix = msg.channelId === meta.channels?.musix;
			if (isStaffMusix && !memberIsAdmin(msg.member)) {
				await msg.reply("Ten kanał jest tylko dla roli **Admin**.");
				return;
			}

			const content = msg.content.trim();
			const lower = content.toLowerCase();

			if (lower === "!queue" || lower === "!q") {
				await msg.reply(queue.queueText());
				await queue.bumpBoard();
				return;
			}
			if (lower === "!np" || lower === "!now") {
				if (!queue.current) {
					await msg.reply("Nic nie gra.");
					return;
				}
				await msg.reply(
					`▶ **${queue.current.title}** — <@${queue.current.requestedBy}> · <t:${Math.floor(queue.current.requestedAt / 1000)}:R>`,
				);
				return;
			}
			if (lower === "!skip" || lower === "!next") {
				if (!queue.current && !queue.tracks.length) {
					await msg.reply("Nie ma czego skipować.");
					return;
				}
				await msg.reply("⏭ skip");
				queue.skip();
				return;
			}
			if (lower === "!stop" || lower === "!leave") {
				queue.clear();
				const conn = getVoiceConnection(guildId);
				if (conn) conn.destroy();
				await queue.bumpBoard();
				await msg.reply("⏹ stop — kolejka wyczyszczona.");
				return;
			}

			let url = null;
			if (lower.startsWith("!play ")) {
				url = extractYoutubeUrl(content.slice(6));
			} else {
				url = extractYoutubeUrl(content);
			}
			if (!url) {
				if (lower.startsWith("!")) {
					await msg.reply(
						"Komendy: `!play <yt>` · `!queue` · `!skip` · `!np` · `!stop` (albo wklej sam link YT).",
					);
				}
				return;
			}

			const status = await msg.reply("⏳ ładuję…");
			let track;
			try {
				track = await resolveTrack(url);
			} catch (e) {
				await status.edit(`Nie udało się pobrać: ${e.message}`);
				return;
			}
			track.requestedBy = msg.author.id;
			track.requestedAt = Date.now();
			queue.enqueue(track);

			const guild = msg.guild;
			const started = await queue.startIfIdle(guild, musixVoiceId);
			await queue.bumpBoard();
			if (started && started.url === track.url) {
				await status.edit(
					`▶ **${track.title}** (\`${formatDuration(track.duration)}\`) — gramy · wejdź na VC **Musix**`,
				);
			} else {
				await status.edit(
					`➕ **${track.title}** w kolejce (#${queue.tracks.length})`,
				);
			}
		} catch (e) {
			console.error("[Musix] message:", e);
			try {
				await msg.reply(`Błąd: ${e.message}`);
			} catch {
				/* ignore */
			}
		}
	});

	await client.login(token);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
