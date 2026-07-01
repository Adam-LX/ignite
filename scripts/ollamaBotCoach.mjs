#!/usr/bin/env node
/**
 * Lokalny „coach” botów przez Ollama — tylko dev, nic nie idzie do gry automatycznie.
 *
 *   ollama serve
 *   npm run coach:bots:ollama
 *
 * Opcjonalnie: data/bot-progress-export.json (eksport z localStorage ignite-bot-progress-log)
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OLLAMA = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
	/\/$/,
	"",
);
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const POLICY_PATH = path.join(ROOT, "public/assets/ai/bot-policy.json");
const PROGRESS_PATH = path.join(ROOT, "data/bot-progress-export.json");
const OUT_PATH = path.join(ROOT, "data/ollama-bot-coach.txt");

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

function buildPrompt(policy, progress) {
	const policyBlock = policy
		? `Polityka MLP (bot-policy.json):
- generation: ${policy.generation ?? "?"}
- fitness: ${policy.fitness ?? "?"}
- w1 len: ${policy.w1?.length ?? 0}`
		: "Brak public/assets/ai/bot-policy.json — boty na domyślnej / cache przeglądarki.";

	const progressBlock = progress
		? `Ostatnie wpisy postępu (${Math.min(8, progress.length)} z ${progress.length}):
${JSON.stringify(progress.slice(-8), null, 2)}`
		: "Brak data/bot-progress-export.json (opcjonalny eksport z localStorage).";

	return `Jesteś asystentem dev gry car soccer (Rocket League–like). Boty używają:
- heurystyki FSM (BotBehavior.ts)
- małej sieci MLP 18→20→4 (BotPolicy.ts) modulującej tuning
- ewolucji offline: npm run train:bots (BotEvolution.ts)
- uczenia online w przeglądarce (policy gradient + micro-evolve)

LLM NIE może zastąpić MLP w ticku (za wolno). Możesz doradzić:
1) parametry treningu wsadowego (BOT_TRAIN_GENS, BOT_TRAIN_POP, BOT_TRAIN_SEC)
2) czy warto więcej aerial / agresji / defense na podstawie fitness
3) czy uruchomić dłuższy train:bots

${policyBlock}

${progressBlock}

Odpowiedz po polsku, zwięźle (max 12 punktów), konkretne komendy bash jeśli sensowne.`;
}

async function ollamaChat(prompt) {
	const res = await fetch(`${OLLAMA}/api/chat`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: MODEL,
			stream: false,
			messages: [{ role: "user", content: prompt }],
		}),
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
	}
	const data = await res.json();
	return data.message?.content?.trim() ?? "(pusta odpowiedź)";
}

async function main() {
	const policy = readJson(POLICY_PATH);
	const progressRaw = readJson(PROGRESS_PATH);
	const progress = Array.isArray(progressRaw) ? progressRaw : null;

	console.info(`[ollama-bot-coach] model=${MODEL} host=${OLLAMA}`);

	const prompt = buildPrompt(policy, progress);
	const reply = await ollamaChat(prompt);

	fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
	const stamp = new Date().toISOString();
	const out = `# Ollama bot coach — ${stamp}\n# model: ${MODEL}\n\n${reply}\n`;
	fs.writeFileSync(OUT_PATH, out, "utf8");

	console.info(`\n${reply}\n`);
	console.info(`[ollama-bot-coach] zapisano: ${OUT_PATH}`);
}

main().catch((err) => {
	console.error("[ollama-bot-coach] błąd:", err.message);
	console.error(
		"Upewnij się: ollama serve · model pobrany (ollama pull llama3.2)",
	);
	process.exit(1);
});
