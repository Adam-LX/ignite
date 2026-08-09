# Boty — architektura i uczenie

Boty w Ignite to **hybryda**: klasyczny algorytm taktyczny (FSM + heurystyki) oraz mała sieć neuronowa, która **moduluje** zachowanie, ale nie zastępuje całego sterowania.

---

## Warstwa 1: algorytm (heurystyka)

Główny „mózg operacyjny” to `src/ai/BotBehavior.ts` — zawsze aktywny, niezależnie od uczenia.

| Element | Opis |
|---------|------|
| **FSM** | Stany: `ALIGN_SHOT`, `REPOSITION`, `RECOVERY`, `AERIAL` |
| **Taktyka** | Intercept, shadow/okrążenie, clearance, kickoff (`botTactics.ts` — `computeStrikeApproachTarget`) |
| **Strzał** | Podejście z tyłu piłki → przebicie; dodge gdy `isAlignedForShot`; aerial tylko blisko + boost |
| **Wall-ride** | `applyWallAvoidance` nie ściąga z bandy gdy bot już na ścianie / piłka wysoko; steer po normalnej jak Meridian |
| **Recovery** | `botRecovery.ts` + air-roll (`SimulatedInput.shift` + A/D); snap ~0.95 s; probe fail ~2% |
| **Boost pads** | Po usunięciu passive regen: `shouldSeekBoostPad` + `pickNearestBoostPad` — detour gdy tank niski |
| **Sterowanie** | Vector steering, oszczędny boost (33% spawn), sekwencje dodge / front flip |
| **Role** | Bramkarz / support / FFA — przydział w `src/ai/AIManager.ts` |

Bot sam decyduje, dokąd jechać, kiedy skakać (heurystycznie), jak unikać murów i jak wykonać dodge. To nie jest end-to-end RL sterujący kółkami bezpośrednio.

---

## Warstwa 2: sieć neuronowa (mała MLP)

Implementacja: `src/ai/learning/BotPolicy.ts` — własna, lekka sieć w TypeScript (bez PyTorch / TensorFlow). Działa w przeglądarce i w skryptach Node.

| Parametr | Wartość |
|----------|---------|
| Wejścia | **18** — pozycja piłki, prędkości, dystanse, kontekst meczu (`BotObservation.ts`) |
| Warstwa ukryta | **32** neuronów, aktywacja `tanh` |
| Wyjścia | **12** — taktyka, sterowanie, cel 3D, autonomia (`BotLearningTuning.ts`) |

Sieć **nie zastępuje** recovery ani kickoffu. Wyniki trafiają do `BotLearningTuning.ts`:

| Wyjście | Wpływ |
|---------|--------|
| `[0]` | `interceptLead`, `aggression` |
| `[1]` | `challengeRadiusMul`, `aerialBias` |
| `[2]` | `boostDistanceMul`, `boostBias` → blend boostu |
| `[3]` | `defenseBias`, decyzja **skoku** |
| `[4]` | **forward** (blend z heurystyką) |
| `[5]` | **yaw** (blend z heurystyką) |
| `[6]` | **offset celu** boczny + `strikeApproach` |
| `[7]` | **lead** wzdłuż piłki + wysokość aerial |
| `[8]`–`[10]` | **Cel 3D** względem piłki (aim point) |
| `[11]` | **`policyAutonomy`** — siła nadpisania heurystyki (do 100%) |

`applyLearnedTargetOffset()` może **zastąpić** heurystyczny cel punktem wybranym przez sieć.

Przy wysokiej autonomii sieć sama inicjuje skok, boost w locie i sterowanie. Recovery / kickoff / turtle chroni heurystyka. Polityka aktywna od załadowania wag; maturity do **1.0**.

---

## Przepływ w ticku gry

```
BotBehavior.think()     → beginThink() → pickTarget + offset celu → heurystyka (FSM, steer)
        ↓
BotLearning.think()     → blend forward/yaw + boost/jump
        ↓
SimulatedInput          → RocketCar (ten sam pipeline co gracz)
```

Obserwacja (`buildBotObservation`) i nagrody krokowe są zapisywane pod online learning (`reinforceRollout`).

---

## Jak boty się uczą?

### 1. Online — podczas gry

Moduł: `src/ai/learning/BotLearning.ts`

- **Nagrody krokowe** — zbliżanie do piłki, kierunek piłki w stronę bramki przeciwnika, dotknięcia w powietrzu
- **Nagrody za gole** — `onGoal()` (+3.4 / −2.4)
- **Koniec meczu** — `onMatchEnd()` aktualizuje fitness, `reinforce()` na rolloutach, mutacja wag
- **`policy.reinforce()`** — prosty policy gradient na wagach MLP (bez backprop frameworka)
- **Rollback** — po dużej przegranej przywrócenie `bestPolicy` + mutacja
- **Micro-evolve** — po meczu kilka mutantów ocenianych headless na pełnym stacku (`HeadlessBotMatch.ts`)

Cache lokalny: `localStorage` → klucz `ignite-bot-policy-cache`.

### 2. Offline — trening wsadowy

```bash
npm run train:bots
```

Skrypt: `scripts/trainBots.ts` → `src/ai/learning/BotEvolution.ts`

- **Algorytm ewolucyjny** — populacja polityk, turniej, crossover, mutacja
- **Fitness** — symulacja headless (`evaluateBotStackEpisode`) na pełnym `BotBehavior` + `BotLearning`
- Wynik: seed `public/assets/ai/bot-policy.json` (ładowany przy starcie gry)

### 2b. Lokalny pre-trening CUDA (PyTorch)

```bash
npm run train:bots:cuda          # pełny przebieg na GPU
npm run train:bots:cuda:smoke    # szybki test
npm run train:bots               # dopracowanie na pełnej fizyce Rapier
```

Skrypt: `scripts/trainBotsCuda.py` — ewolucja MLP na **uproszczonej** symulacji 2D (proxy fitness, szybciej na RTX). Eksportuje ten sam format `bot-policy.json` co `BotPolicy.ts`. **Nie zastępuje** `train:bots` — po CUDA warto jeszcze odpalić trening TS na headless meczu.

Po `train:bots` / `train:bots:cuda` polityka **automatycznie** scala się z globalnym mózgiem i idzie na gałąź `bot-brain` (GitHub) + relaye z `policy-relays.json` (`scripts/publishTrainedPolicy.ts`). Wymaga `gh auth` lub `GITHUB_TOKEN`. Wyłącz: `SKIP_BOT_POLICY_PUBLISH=1`.

Ollama (`npm run coach:bots:ollama`) — tylko doradca tekstowy, nie trenuje wag.

### 3. Federacja (wspólny mózg)

Opis operacyjny: sekcja „Globalne uczenie botów” w `README.md`.

- Start: `public/assets/ai/bot-policy.json` + relay `hostname:8765`
- Gałąź release **`bot-brain`**: `global-bot-policy.json`
- Klient **pobiera** politykę (`fetchGlobalBotPolicy`), **wysyła** wyniki meczów (`pushGlobalBotPolicy`)
- Merge wielu relayów: `src/net/policyMerge.ts`

```bash
npm run mp:server           # mecze vs boty, sync polityki
npm run publish:bot-policy    # publikacja na gałąź bot-brain
```

---

## Kluczowe pliki

| Plik | Rola |
|------|------|
| `src/ai/BotBehavior.ts` | FSM, taktyka, steering, dodge |
| `src/ai/AIManager.ts` | Rejestr botów, role, intercept z uczenia |
| `src/ai/botRecovery.ts` | Unstable / stable — wall-ride aware |
| `src/ai/learning/BotPolicy.ts` | MLP — wagi, predict, reinforce, mutate |
| `src/ai/learning/BotLearning.ts` | Orchestracja uczenia online + federacja |
| `src/ai/learning/BotLearningTuning.ts` | Mapowanie wyjść sieci → parametry taktyki |
| `src/ai/learning/BotObservation.ts` | Wektor obserwacji (18 liczb) |
| `src/ai/learning/BotJumpResolver.ts` | Bramka skoku (heurystyka + sieć) |
| `src/ai/learning/BotEvolution.ts` | Ewolucja offline |
| `src/ai/learning/HeadlessBotMatch.ts` | Symulacja do oceny fitness |
| `public/assets/ai/bot-policy.json` | Wytrenowany seed |
| `tests/ai/botLearning.test.ts` | Testy polityki i uczenia |

### Diagnostyka (pętla agentowa)

```bash
npm run audit:wall-ceiling   # fizyka wall-ride + sufit → test-results/wall-ceiling/
npm run probe:matches        # boty headless → data/match-probes/FINDINGS.md
npm run probe:matches:smoke  # 1×15 s
```

Match Probe zbiera m.in. `wallSec` / `ceilingSec` / strefy boiska. Alerty:
- `wall_ride_absent` — boty unikają band
- `zero_scoring` — dużo touchy, mało goli (podejście/strzał)

**Logika sytuacyjna (heurystyka, nie sieć):** `computeStrikeApproachTarget` — clearance / okrążenie / shadow / przebicie; aerial tylko gdy blisko + boost; dodge przy `isAlignedForShot`.

---

## Podsumowanie

| Co | Jak |
|----|-----|
| Jazda, pozycja, flip, recovery | Algorytm (FSM + heurystyki) |
| Agresja, boost, skok, aerial bias | Mała sieć neuronowa (MLP 18→20→4) |
| Trening w grze | Reinforce + mutacje + micro-evolve |
| Trening offline | Ewolucja genetyczna (`npm run train:bots`) |
| Backend ML | Brak — czysty TypeScript w przeglądarce / Node |
| Postęp w UI | Menu główne — generacja, fitness (`BotLearningProgress.ts`) |

**Nie jest to** czyste deep RL (PPO/SAC) ani bot wyłącznie skryptowy — sieć uczy się **dostrajać** heurystykę pod wynik meczu, a nie uczy się jazdy od zera.

---

## IQ i raport w menu

Wskaźnik **IQ (78–165, środek ~100)** to złożona metryka UI z `src/ai/learning/BotIQ.ts`, nie test psychometryczny.

| Składnik | Wpływ |
|----------|--------|
| `fitness` | Jakość bieżącej polityki (EMA po meczach) |
| `bestFitness` | „Sufit” — najlepszy zapisany mózg |
| `generation` | Doświadczenie / liczba cykli uczenia |
| Forma (`botDelta`) | Średni wynik botów w ostatnich meczach |
| Aerial / mecz | Loty i dotknięcia w powietrzu |
| `microPromotions` | Udane micro-evolve po meczu |

**Raport** (menu → przycisk „Raport uczenia botów” lub **B**):

- pierścień IQ + tier: Rookie / Trained / Sharp / Elite
- wykres IQ w czasie
- wykres fitness (trening wewnętrzny)
- słupki formy (`botDelta` — zielone = boty na plusie, czerwone = przegrana)

Spadek wykresu fitness **nie oznacza**, że boty trwale głupieją — często oznacza, że **wygrywasz ty** albo że algorytm eksploruje mutacje. Patrz na **IQ**, **Best** i **win rate**.

CLI: `npm run bot:progress` (export z `localStorage` → `ignite-bot-progress-log`).
