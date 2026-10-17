#!/usr/bin/env bash
# Status sesji sustained — ile zostało do deadline.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
F="${1:-${ROOT}/.cursor/sustained-session.json}"
GLOBAL="${HOME}/.cursor/sustained-session.json"

if [[ ! -f "${F}" && -f "${GLOBAL}" ]]; then
	F="${GLOBAL}"
fi
if [[ ! -f "${F}" ]]; then
	echo "Brak pliku sesji: ${F}"
	echo "Utwórz .cursor/sustained-session.json lub ~/.cursor/sustained-session.json"
	exit 1
fi

python3 <<PY
import json
from datetime import datetime, timezone
from pathlib import Path

path = Path("${F}")
data = json.loads(path.read_text())
now = datetime.now(timezone.utc)
dead = datetime.fromisoformat(data["deadlineAt"].replace("Z", "+00:00"))
started = datetime.fromisoformat(data["startedAt"].replace("Z", "+00:00"))
left = dead - now
elapsed = now - started
h = data.get("durationHours", "?")
print(f"Sesja sustained ({h}h)")
print(f"  Projekt: {data.get('projectPath', '—')}")
print(f"  Start:   {started.astimezone().strftime('%Y-%m-%d %H:%M %Z')}")
print(f"  Deadline: {dead.astimezone().strftime('%Y-%m-%d %H:%M %Z')}")
if left.total_seconds() > 0:
    m = int(left.total_seconds() // 60)
    print(f"  Pozostało: {m // 60}h {m % 60}m")
else:
    print("  STATUS: CZAS MINĄŁ — podsumuj sesję")
print(f"  Upłynęło: {int(elapsed.total_seconds() // 60)} min")
q = data.get("queue") or []
d = data.get("done") or []
if q:
    print(f"  Kolejka ({len(q)}): {q[0]}" + (" …" if len(q) > 1 else ""))
if d:
    print(f"  Zrobione ({len(d)}): {d[-1]}" + (" …" if len(d) > 1 else ""))
PY
