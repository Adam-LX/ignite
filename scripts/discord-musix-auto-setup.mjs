#!/usr/bin/env node
/**
 * Auto-setup Musix bez Developer Portal:
 *  1) bierze sesję z zalogowanego Discord Desktop
 *  2) włącza Message Content Intent
 *  3) resetuje token bota (przy 2FA: zenity / arg / env)
 *  4) zapisuje ~/.config/ignite/discord.env
 *  5) odpala systemctl --user ignite-musix
 *
 * Użycie:
 *   bash scripts/discord-musix-auto.sh
 *   bash scripts/discord-musix-auto.sh 123456   # kod TOTP
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://discord.com/api/v9";
const UA = "Mozilla/5.0 (X11; Linux x86_64) discord/1.0.146";
const APP_FALLBACK = "1525295326456582145";
const ENV_FILE = join(homedir(), ".config/ignite/discord.env");
const META_FILE = join(homedir(), ".config/ignite/discord-server.json");
const LEVELDB = join(homedir(), ".config/discord/Local Storage/leveldb");

const GATEWAY_MESSAGE_CONTENT = 1 << 18;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;

function loadMeta() {
	if (!existsSync(META_FILE)) return {};
	try {
		return JSON.parse(readFileSync(META_FILE, "utf8"));
	} catch {
		return {};
	}
}

function extractUserTokens() {
	const found = new Set();
	const re =
		/(mfa\.[\w-]{80,}|[\w-]{24}\.[\w-]{6}\.[\w-]{25,})/g;
	if (!existsSync(LEVELDB)) return [];
	for (const name of readdirSync(LEVELDB)) {
		if (!name.endsWith(".ldb") && !name.endsWith(".log")) continue;
		let buf;
		try {
			buf = readFileSync(join(LEVELDB, name));
		} catch {
			continue;
		}
		const text = buf.toString("latin1");
		let m;
		while ((m = re.exec(text))) found.add(m[1]);
	}
	return [...found];
}

async function api(token, method, path, body, extraHeaders = {}) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: token,
			"Content-Type": "application/json",
			"User-Agent": UA,
			...extraHeaders,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	let data = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	return { ok: res.ok, status: res.status, data };
}

async function waitForCodeInMusix(userToken, musixChannelId, hint, onSmsResend) {
	if (process.env.IGNITE_MUSIX_TOTP) {
		return process.env.IGNITE_MUSIX_TOTP.trim();
	}
	const arg = process.argv[2];
	if (arg && /^\d{6}$/.test(arg)) return arg;

	if (!musixChannelId) {
		throw new Error(
			"Brak #musix. Podaj kod: bash scripts/discord-musix-auto.sh 123456",
		);
	}

	await api(userToken, "POST", `/channels/${musixChannelId}/messages`, {
		content: hint,
	});
	console.log("[auto] Czekam na kod w #musix…");
	spawnSync(
		"notify-send",
		[
			"-u",
			"critical",
			"Ignite Musix",
			"Wpisz w #musix 6 cyfr z Authenticatora (albo SMS)",
		],
		{ encoding: "utf8" },
	);

	const started = Date.now();
	const deadline = started + 15 * 60 * 1000;
	const seen = new Set();
	while (Date.now() < deadline) {
		const hist = await api(
			userToken,
			"GET",
			`/channels/${musixChannelId}/messages?limit=20`,
		);
		if (hist.ok && Array.isArray(hist.data)) {
			for (const m of hist.data) {
				const ts = new Date(m.timestamp).getTime();
				if (ts < started - 1500) continue;
				if (seen.has(m.id)) continue;
				seen.add(m.id);
				const text = String(m.content || "").trim();
				if (/^(!?sms|ponow|resend)$/i.test(text) && onSmsResend) {
					const ok = await onSmsResend();
					await api(userToken, "POST", `/channels/${musixChannelId}/messages`, {
						content: ok
							? "🔁 SMS ponowiony — jak nie dojdzie, wpisz kod z **Authenticator**."
							: "❌ Nie udało się ponowić SMS — użyj kodu z Authenticator.",
					});
					continue;
				}
				const code =
					(/^(\d{6})$/.exec(text) ||
						/^!2fa\s+(\d{6})$/i.exec(text) ||
						[])[1] || null;
				if (code) {
					await api(userToken, "POST", `/channels/${musixChannelId}/messages`, {
						content: "✅ Kod przyjęty — konfiguruję bota…",
					});
					return code;
				}
			}
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	throw new Error("Timeout — nie dostałem kodu w #musix (15 min).");
}

async function main() {
	const meta = loadMeta();
	const tokens = extractUserTokens();
	if (!tokens.length) {
		throw new Error(
			"Brak sesji Discord Desktop — otwórz Discord i zaloguj się, potem ponów.",
		);
	}

	let userToken = null;
	let me = null;
	for (const t of tokens) {
		const r = await api(t, "GET", "/users/@me");
		if (r.ok) {
			userToken = t;
			me = r.data;
			break;
		}
	}
	if (!userToken) {
		throw new Error("Sesja Discord nieważna — zaloguj się ponownie w Discord Desktop.");
	}
	console.log(`[auto] sesja: ${me.username}`);

	const apps = await api(
		userToken,
		"GET",
		"/applications?with_team_applications=true",
	);
	if (!apps.ok) throw new Error(`apps: ${apps.status}`);
	const wantId = String(meta.clientId || APP_FALLBACK);
	let app =
		apps.data.find((a) => String(a.id) === wantId) ||
		apps.data.find((a) => String(a.name).toLowerCase() === "ignite") ||
		apps.data[0];
	if (!app) throw new Error("Brak aplikacji bota na koncie");
	const appId = String(app.id);
	console.log(`[auto] app: ${app.name} (${appId})`);

	const detail = await api(userToken, "GET", `/applications/${appId}`);
	if (!detail.ok) throw new Error(`get app: ${detail.status}`);
	let flags = Number(detail.data.flags || 0);
	const newFlags =
		(flags | GATEWAY_MESSAGE_CONTENT) & ~GATEWAY_MESSAGE_CONTENT_LIMITED;
	if (newFlags !== flags) {
		const p = await api(userToken, "PATCH", `/applications/${appId}`, {
			flags: newFlags,
		});
		console.log(`[auto] Message Content Intent → ${p.status}`);
	} else {
		console.log("[auto] Message Content Intent już ustawiony / pending");
	}

	let reset = await api(userToken, "POST", `/applications/${appId}/bot/reset`);
	let botToken = reset.data?.token;

	if (reset.status === 401 && reset.data?.code === 60003) {
		const ticket = reset.data?.mfa?.ticket;
		const methods = (reset.data?.mfa?.methods || []).map((m) => m.type);
		if (!ticket) throw new Error("2FA wymagane, ale brak ticketu MFA");
		console.log(`[auto] Discord wymaga 2FA (metody: ${methods.join(", ")})`);

		const codeFromArg =
			(process.env.IGNITE_MUSIX_TOTP || "").trim() ||
			(process.argv[2] && /^\d{6}$/.test(process.argv[2])
				? process.argv[2]
				: "");

		/** Jak mamy kod z arg — to Authenticator (TOTP). Nie marnuj SMS-em. */
		if (!codeFromArg && methods.includes("sms")) {
			const sms = await api(userToken, "POST", "/auth/mfa/sms/send", {
				ticket,
			});
			if (sms.ok) {
				console.log(
					`[auto] SMS API OK → ${sms.data?.phone || "telefon"} (często nie dochodzi — lepiej Authenticator)`,
				);
			} else {
				console.warn(
					`[auto] SMS send fail ${sms.status}: ${JSON.stringify(sms.data)}`,
				);
			}
		}

		const hint =
			`**Musix auto-setup — 2FA**\n` +
			`SMS Discord **często nie dochodzi**.\n\n` +
			`**Zrób to:** otwórz **Google Authenticator / Aegis / Bitwarden** → wklej **6 cyfr**.\n` +
			`Albo: \`bash scripts/discord-musix-auto.sh 123456\``;

		const code =
			codeFromArg ||
			(await waitForCodeInMusix(
				userToken,
				meta.channels?.musix,
				hint,
				async () => {
					const sms = await api(userToken, "POST", "/auth/mfa/sms/send", {
						ticket,
					});
					console.log(
						`[auto] SMS resend → ${sms.status} ${JSON.stringify(sms.data)}`,
					);
					return sms.ok;
				},
			));
		if (!/^\d{6}$/.test(code)) {
			throw new Error("Kod musi mieć 6 cyfr");
		}

		async function finishMfa(mfaType, codeStr, ticketStr) {
			return api(userToken, "POST", "/mfa/finish", {
				ticket: ticketStr,
				mfa_type: mfaType,
				data: codeStr,
			});
		}

		/** Kod z CLI = TOTP najpierw (SMS pali ticket i psuje kod Authenticatora). */
		let mfa = null;
		const order = codeFromArg
			? ["totp", "sms"]
			: methods.includes("sms")
				? ["sms", "totp"]
				: ["totp", "sms"];
		let ticketNow = ticket;
		for (const mfaType of order) {
			if (!methods.includes(mfaType)) continue;
			mfa = await finishMfa(mfaType, code, ticketNow);
			if (mfa.ok && mfa.data?.token) {
				console.log(`[auto] MFA OK przez ${mfaType}`);
				break;
			}
			console.warn(
				`[auto] MFA ${mfaType} fail ${mfa.status}: ${JSON.stringify(mfa.data)}`,
			);
			const again = await api(
				userToken,
				"POST",
				`/applications/${appId}/bot/reset`,
			);
			ticketNow = again.data?.mfa?.ticket || ticketNow;
		}
		if (!mfa?.ok || !mfa.data?.token) {
			throw new Error(
				`MFA fail: ${JSON.stringify(mfa?.data)} — weź ŚWIEŻY kod z Authenticatora (co ~30 s) i odpal od razu:\n  bash scripts/discord-musix-auto.sh 123456`,
			);
		}
		reset = await api(
			userToken,
			"POST",
			`/applications/${appId}/bot/reset`,
			undefined,
			{ "X-Discord-MFA-Authorization": mfa.data.token },
		);
		botToken = reset.data?.token;
	}

	if (!reset.ok || !botToken) {
		throw new Error(
			`Reset tokena nieudany ${reset.status}: ${JSON.stringify(reset.data)}`,
		);
	}
	console.log(`[auto] nowy bot token OK (len=${botToken.length})`);

	const guildId = meta.guildId || "1530332650924019953";
	writeFileSync(
		ENV_FILE,
		`# Ignite Discord — chmod 600 (auto)\nDISCORD_CLIENT_ID=${appId}\nDISCORD_BOT_TOKEN=${botToken}\nDISCORD_GUILD_ID=${guildId}\n`,
		{ mode: 0o600 },
	);
	console.log(`[auto] zapisano ${ENV_FILE}`);

	/** Skróć pin w #musix — bez ręcznej instrukcji portalu. */
	const ch = meta.channels?.musix;
	if (ch) {
		const help =
			"**Musix — kolejka Admin**\n" +
			"Wklej link YouTube / `!play <url>` → bot gra na VC **Musix**.\n\n" +
			"Playlista aktualizuje się sama: kto · kiedy · co · ▶ teraz gra\n" +
			"`!skip` · `!stop` · `!queue` · `!np`";
		const pins = await api(userToken, "GET", `/channels/${ch}/pins`);
		if (pins.ok) {
			for (const p of pins.data || []) {
				if (String(p.content || "").includes("Musix")) {
					await api(
						userToken,
						"DELETE",
						`/channels/${ch}/pins/${p.id}`,
					);
				}
			}
		}
		const msg = await api(userToken, "POST", `/channels/${ch}/messages`, {
			content: help,
		});
		if (msg.ok) {
			await api(
				userToken,
				"PUT",
				`/channels/${ch}/pins/${msg.data.id}`,
			);
			console.log("[auto] pin #musix zaktualizowany");
		}
	}

	/** systemd user service */
	const unit = join(homedir(), ".config/systemd/user/ignite-musix.service");
	if (!existsSync(unit)) {
		writeFileSync(
			unit,
			`[Unit]
Description=Ignite Discord Musix queue bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${join(homedir(), "Dokumenty/Projekty/Ignite")}
ExecStart=${join(homedir(), "Dokumenty/Projekty/Ignite/scripts/discord-musix-run.sh")}
Restart=on-failure
RestartSec=8
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`,
			{ mode: 0o644 },
		);
	}

	spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
	const en = spawnSync(
		"systemctl",
		["--user", "enable", "--now", "ignite-musix"],
		{ encoding: "utf8" },
	);
	console.log(en.stdout || "");
	console.log(en.stderr || "");
	if (en.status !== 0) {
		console.log("[auto] systemd nie wstąpił — odpalam bota w tle…");
		spawnSync("bash", [join(homedir(), "Dokumenty/Projekty/Ignite/scripts/discord-musix-run.sh")], {
			detached: true,
			stdio: "ignore",
		}).unref?.();
	} else {
		const st = spawnSync(
			"systemctl",
			["--user", "is-active", "ignite-musix"],
			{ encoding: "utf8" },
		);
		console.log(`[auto] service: ${st.stdout.trim()}`);
	}

	console.log(`
✅ Musix auto-setup gotowy.
Wejdź na VC Musix i w #musix wklej link YouTube.
`);
}

main().catch((err) => {
	console.error("[auto]", err.message || err);
	process.exit(1);
});
