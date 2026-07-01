# Audio assets — licenses (Ignite)

Unless noted otherwise, files here are **free for commercial use** without royalties.

**Disclaimer:** Ignite is not affiliated with Epic Games, Psyonix, or Rocket League®.

**Release komercyjny:** używaj `match_msx.mp3` (MIT) lub `match_loop.mp3` (CC0). Nie bundluj plików MusicGen (`*_ai.mp3`, `match_moroder_racer.mp3` z MusicGen). Szczegóły: [`MUSIC.md`](MUSIC.md).

| File(s) | Source | License |
|---------|--------|---------|
| `sfx/engine_low.wav` | [BigSoundBank #0291](https://bigsoundbank.com/car-engine-1-s0291.html) | CC0 |
| `sfx/engine_high.wav` | [OpenGameArt — loop_2](https://opengameart.org/content/car-engine-loop-2) | CC0 / Public Domain |
| `sfx/impact_car_ball_*.ogg` | [BigSoundBank #1044 Ball Kicked](https://bigsoundbank.com/ball-kicked-s1044.html) (wycinki) | CC0 |
| `sfx/impact_ball_floor_*.ogg` | [BigSoundBank #0584 Tennis Ball Bounce](https://bigsoundbank.com/tennis-ball-bounce-s0584.html) (wycinki) | CC0 |
| `sfx/impact_ball_wall_0–1.ogg` | [BigSoundBank #1825–1826 Balloon against wall](https://bigsoundbank.com/) | CC0 |
| `sfx/supersonic.ogg` | [BigSoundBank #1797 whoosh](https://bigsoundbank.com/) | CC0 |
| `sfx/countdown_tick.ogg`, `sfx/boost_loop.ogg`, `sfx/kickoff.ogg`, pozostałe `sfx/impact_*.ogg`, `sfx/goal_*.ogg` | [Kenney.nl](https://kenney.nl/assets) | CC0 |
| `music/match_loop.mp3` | [Neon sign Circuit [Remake]](https://opengameart.org/content/neon-sign-circuit-remake) by MintoDog | **CC0** |
| `music/match_climax.mp3` | j.w.w. (wersja „Climax”, 160 BPM) | **CC0** |
| `music/match_loop_ai.mp3` | MusicGen (`facebook/musicgen-small`) | **CC-BY-NC** — **nie** do komercji |
| `music/match_loop.mp3` (po `generate --backend stable-audio`) | Stable Audio Open + preset FlyBall | [Stability AI Community License](https://stability.ai/license) — komercja przy przychodzie &lt; $1M/rok + rejestracja |
| `music/match_vocal_*.mp3` | ACE-Step 1.5 lokalnie (`flyball-music vocal`) | **MIT** — komercja OK |

ACE-Step MIT — dołącz notice w credits (patrz [LICENSE](https://github.com/ACE-Step/ACE-Step-1.5/blob/main/LICENSE)).

## Muzyka z wokalem — ACE-Step 1.5 (zalecane)

Najbliżej Suno/Prodigy-style — **pełna piosenka z wokalem**, licencja **MIT**.

```bash
# 1. Start API (pierwszy raz: pobiera modele ~10 GB)
flyball-music ace-step up
flyball-music ace-step health   # czekaj aż "status": "ok"

# 2. Generacja (oryginalne słowa + preset prodigy_vocal)
flyball-music vocal --style prodigy_vocal --duration 90 --seed 42 \
  --out public/assets/audio/music/match_msx.mp3

# Gradio UI (ręczne testy):
flyball-music ace-step ui     # http://localhost:7860

# Autostart:
flyball-music ace-step install && systemctl --user start flyball-ace-step
```

Preset: `scripts/music/styles/prodigy_vocal.yaml` — big beat + agresywny wokal (oryginalne lyrics, nie kopia YT).

**GPU:** RTX 5070 Ti 16 GB → LM `acestep-5Hz-lm-0.6B` (w `docker/ace-step/.env`).

## Generator instrumentalny

### Stable Audio Open — **komercyjnie** (zalecane)

Lokalny kontener Docker (GPU). **Nie** jest to Suno — brak wokali, krótsze klipy (~47 s), pełna kontrola lokalna.

```bash
# 1. Zaakceptuj licencję modelu na Hugging Face:
#    https://huggingface.co/stabilityai/stable-audio-open-1.0
# 2. Token → docker/stable-audio/.env (HF_TOKEN=...)
cp docker/stable-audio/.env.example docker/stable-audio/.env

flyball-music stable-audio up          # build + start kontenera
flyball-music stable-audio health      # czekaj aż "ok": true

nix develop .#music
flyball-music generate --backend stable-audio --style racer_like --duration 90 \
  --out public/assets/audio/music/match_loop.mp3
```

Autostart (systemd user):

```bash
flyball-music stable-audio install
systemctl --user start flyball-stable-audio
```

Rejestracja komercyjna: [stability.ai/community-license](https://stability.ai/community-license)

### MusicGen — tylko dev / non-commercial

```bash
nix develop .#music
flyball-music generate --style racer_like   # domyślnie MusicGen (NC)
```

Każda generacja zapisuje `*.provenance.json` (model, prompt, seed, licencja).
