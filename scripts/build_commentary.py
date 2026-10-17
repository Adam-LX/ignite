#!/usr/bin/env python3
"""Buduje bank komentatora Ignite z data/commentary/phrases.yaml.

Wymaga TTS (XTTS / tts-swos-tts):
  SWOS_TTS_URL=http://127.0.0.1:9004
  bash scripts/build-commentary.sh

Zmienne:
  SWOS_TTS_URL=http://127.0.0.1:9004
  SWOS_TTS_FORCE=1   — regeneruj istniejące OGG
  IGNITE_TTS=0       — tylko manifest (bez syntezy)
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
PHRASES = ROOT / "data" / "commentary" / "phrases.yaml"
OUT_DIR = ROOT / "public" / "assets" / "audio" / "commentary"
OUT_MANIFEST = OUT_DIR / "commentary-manifest.json"

# Dynamiczny radio-net — szersze pasmo, mniej „martwego” crusha, więcej punch.
ROBOT_BODY = (
    "highpass=f=280,"
    "lowpass=f=5200,"
    "equalizer=f=900:t=q:w=0.85:g=4.5,"
    "equalizer=f=2400:t=q:w=1.0:g=5.5,"
    "equalizer=f=4200:t=q:w=1.2:g=2.5,"
    "acrusher=bits=8:mode=log:aa=1:mix=0.28,"
    "acompressor=threshold=-18dB:ratio=6:attack=1.2:release=40:makeup=6.5,"
    "aecho=0.72:0.52:9:0.09,"
    "loudnorm=I=-11:TP=-1.0:LRA=7,"
    "alimiter=limit=0.96"
)

ROBOT_AF = (
    "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.015:"
    "stop_periods=-1:stop_threshold=-44dB:stop_silence=0.05,"
    + ROBOT_BODY
)

# Cyfry kickoffu / final 10 — krótki, ostry burst.
COUNTDOWN_DIGIT_AF = (
    "silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.01:"
    "stop_periods=-1:stop_threshold=-44dB:stop_silence=0.04,"
    + ROBOT_BODY
    + ",atempo=1.08,atrim=0:0.85"
)

COUNTDOWN_GO_AF = (
    "silenceremove=stop_periods=-1:stop_threshold=-44dB:stop_silence=0.06,"
    + ROBOT_BODY
    + ",atrim=0:1.25"
)

UNIFIED_TTS = {"voice": "commentator_excited", "temperature": 0.72, "speed": 1.12}
DEFAULT_TTS: dict[str, dict] = {
    k: dict(UNIFIED_TTS)
    for k in (
        "goal",
        "epic_save",
        "demolish",
        "kickoff",
        "countdown_10",
        "countdown_9",
        "countdown_8",
        "countdown_7",
        "countdown_6",
        "countdown_5",
        "countdown_4",
        "countdown_3",
        "countdown_2",
        "countdown_1",
        "countdown_go",
        "clock_60",
        "clock_30",
        "power_shot",
        "flip_reset",
        "aerial",
        "post_hit",
        "near_miss",
        "blue_ahead",
        "orange_ahead",
        "overtime",
        "match_end",
        "scramble",
        "turtle",
        "fifty_fifty",
        "idle_ball",
        "big_boom",
        "player_lazy",
        "player_hot",
        "player_praise",
        "player_roast",
        "player_hustle",
        "player_spectator",
        "blue_praise",
        "orange_praise",
        "blue_roast",
        "orange_roast",
        "score_taunt",
        "crate_drop",
    )
}

COUNTDOWN_DIGIT_EVENTS = {
    "countdown_10",
    "countdown_9",
    "countdown_8",
    "countdown_7",
    "countdown_6",
    "countdown_5",
    "countdown_4",
    "countdown_3",
    "countdown_2",
    "countdown_1",
}


def slug(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9ąćęłńóśźż]+", "_", s, flags=re.IGNORECASE)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:48] or "line"


def tts_enabled() -> bool:
    return os.environ.get("IGNITE_TTS", "1") != "0"


def tts_url() -> str:
    return os.environ.get("SWOS_TTS_URL", "http://127.0.0.1:9004").rstrip("/")


def tts_force() -> bool:
    return os.environ.get("SWOS_TTS_FORCE", "0") in ("1", "true", "yes")


def load_phrases() -> dict:
    text = PHRASES.read_text(encoding="utf-8")
    if yaml is None:
        raise SystemExit("Brak PyYAML — pip install pyyaml / nix shell nixpkgs#python3Packages.pyyaml")
    data = yaml.safe_load(text)
    locales = data.get("locales")
    if not isinstance(locales, dict):
        raise SystemExit(f"Nieprawidłowy format {PHRASES}: oczekiwano locales:")
    return locales


def synthesize_xtts(
    text: str,
    language: str,
    voice: str,
    temperature: float,
    speed: float,
) -> bytes | None:
    payload = {
        "model": "tts-1",
        "input": text,
        "voice": voice,
        "language": language,
        "response_format": "wav",
        "temperature": temperature,
        "speed": speed,
    }
    req = urllib.request.Request(
        f"{tts_url()}/v1/audio/speech",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        print(f"  TTS HTTP {exc.code}: {exc.read().decode(errors='replace')[:200]}")
        return None
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"  TTS fail: {exc}")
        return None


def wav_to_stadium_ogg(wav_bytes: bytes, ogg_path: Path, *, af: str) -> bool:
    if shutil.which("ffmpeg") is None:
        print("  brak ffmpeg", file=sys.stderr)
        return False
    ogg_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ignite-com-") as tmp:
        wav_path = Path(tmp) / "in.wav"
        wav_path.write_bytes(wav_bytes)
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(wav_path),
            "-af",
            af,
            "-ar",
            "48000",
            "-c:a",
            "libvorbis",
            "-q:a",
            "5",
            str(ogg_path),
        ]
        try:
            subprocess.run(cmd, check=True)
            return ogg_path.is_file()
        except subprocess.CalledProcessError:
            return False


def audio_filter_for_event(event: str) -> str:
    if event == "countdown_go":
        return COUNTDOWN_GO_AF
    if event in COUNTDOWN_DIGIT_EVENTS:
        return COUNTDOWN_DIGIT_AF
    return ROBOT_AF


def encode_clip(event: str, wav: bytes, abs_path: Path) -> bool:
    return wav_to_stadium_ogg(wav, abs_path, af=audio_filter_for_event(event))


def tts_params(event: str, cat: dict) -> dict:
    base = dict(DEFAULT_TTS.get(event, UNIFIED_TTS))
    if cat.get("voice"):
        base["voice"] = cat["voice"]
    if cat.get("temperature") is not None:
        base["temperature"] = float(cat["temperature"])
    if cat.get("speed") is not None:
        base["speed"] = float(cat["speed"])
    return base


def wait_tts_ready() -> bool:
    try:
        with urllib.request.urlopen(f"{tts_url()}/health", timeout=5) as resp:
            health = json.loads(resp.read().decode())
        if health.get("status") != "ok":
            print(f"TTS niegotowy: {health}", file=sys.stderr)
            return False
        print(f"TTS OK @ {tts_url()} — głosy: {health.get('voices', [])}")
        return True
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Brak serwera TTS ({tts_url()}): {exc}", file=sys.stderr)
        return False


def main() -> int:
    if not PHRASES.is_file():
        print(f"Brak {PHRASES}", file=sys.stderr)
        return 1

    locales_in = load_phrases()
    use_tts = tts_enabled()
    if use_tts and not wait_tts_ready():
        print("Uruchom kontener tts-swos-tts na :9004", file=sys.stderr)
        return 1

    manifest: dict = {"version": 2, "locales": {}}
    generated = 0
    skipped = 0

    for locale, events in locales_in.items():
        if not isinstance(events, dict):
            continue
        locale_out: dict = {}
        for event, cat in events.items():
            if not isinstance(cat, dict):
                continue
            lines = cat.get("lines", [])
            cfg = tts_params(event, cat)
            clips = []
            for i, line in enumerate(lines):
                if isinstance(line, str):
                    text = line
                    weight = 1
                else:
                    text = str(line.get("text", "")).strip()
                    weight = int(line.get("weight", 1))
                if not text:
                    continue
                clip_id = f"{event}_{i:02d}_{slug(text)}"
                rel = Path(locale) / event / f"{clip_id}.ogg"
                abs_path = OUT_DIR / rel
                web_path = f"/assets/audio/commentary/{rel.as_posix()}"

                if use_tts and (tts_force() or not abs_path.is_file()):
                    print(f"TTS [{locale}/{cfg['voice']}]: {text[:55]}…")
                    wav = synthesize_xtts(
                        text,
                        locale,
                        cfg["voice"],
                        cfg["temperature"],
                        cfg["speed"],
                    )
                    if wav and encode_clip(event, wav, abs_path):
                        generated += 1
                    else:
                        skipped += 1

                audio = web_path if abs_path.is_file() else ""
                clips.append(
                    {
                        "id": clip_id,
                        "text": text,
                        "weight": weight,
                        "audio": audio,
                    }
                )

            locale_out[event] = {
                "cooldown_sec": float(cat.get("cooldown_sec", 3.5)),
                "clips": clips,
            }
        manifest["locales"][locale] = locale_out

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Manifest: {OUT_MANIFEST}")
    if use_tts:
        print(f"TTS: {generated} wygenerowanych, {skipped} błędów")
    else:
        print("TTS wyłączony (IGNITE_TTS=0)")
    return 0 if skipped == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
