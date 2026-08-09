#!/usr/bin/env python3
"""Submit + poll Trellis badge job; abort on health-down / progress death-loop."""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:8004"
IMG = Path("/home/adam/Dokumenty/Projekty/Ignite/tmp-logo/ignite_badge_trellis_std.png")
OUT = Path("/home/adam/Dokumenty/Projekty/Ignite/public/assets/props/ignite_badge.glb")
WORK = Path("/home/adam/Dokumenty/Projekty/Ignite/public/assets/props/.work/ignite_badge_trellis_raw.glb")
POLL_S = 8
MAX_POLLS = 240  # ~32 min
REGRESS_LIMIT = 3


def free_avail_mib() -> int:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) // 1024
    return -1


def gpu_used_mib() -> int:
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=memory.used",
                "--format=csv,noheader,nounits",
            ],
            text=True,
        )
        return int(out.strip().splitlines()[0])
    except Exception:
        return -1


def get_json(url: str, timeout: float = 15) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def health_ok() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE}/health", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def submit() -> tuple[str, str]:
    boundary = "----trellisbadge"
    body = bytearray()
    fields = {"quality": "standard", "user": "Adam"}
    for k, v in fields.items():
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    data = IMG.read_bytes()
    body += (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
        f'filename="{IMG.name}"\r\nContent-Type: image/png\r\n\r\n'
    ).encode()
    body += data
    body += f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{BASE}/generate",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        j = json.loads(r.read().decode())
    return j["job_id"], j.get("out_id", "")


def download(url: str, dest: Path) -> None:
    if not url.startswith("http"):
        url = BASE + url
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=300) as r:
        dest.write_bytes(r.read())


def clear_queue() -> None:
    subprocess.run(
        ["sudo", "rm", "-fv"] + list(Path("/var/lib/trellis3d/queue").glob("*")),
        check=False,
    )


def main() -> int:
    if not IMG.is_file():
        print(f"MISSING IMAGE {IMG}", file=sys.stderr)
        return 10

    print(f"wait health… avail={free_avail_mib()}MiB")
    for i in range(60):
        if health_ok():
            q = get_json(f"{BASE}/queue")
            print(f"health ok queue={q}")
            if q.get("running") is None:
                break
            print("waiting for idle…")
        else:
            print(f"[{i}] no health")
        time.sleep(2)
    else:
        print("NO HEALTH", file=sys.stderr)
        return 2

    job_id, out_id = submit()
    print(f"SUBMIT job={job_id} out={out_id}")

    prev = -1
    regress = 0
    for i in range(1, MAX_POLLS + 1):
        avail = free_avail_mib()
        gpu = gpu_used_mib()
        if not health_ok():
            print("HEALTH DOWN — likely OOM. Clearing queue.")
            clear_queue()
            return 2
        try:
            st = get_json(f"{BASE}/status/{job_id}")
        except Exception as e:
            print(f"[{i}] status err {e}")
            time.sleep(POLL_S)
            continue

        status = st.get("status")
        prog = st.get("progress", -1)
        phase = st.get("phase")
        msg = str(st.get("message", ""))[:60]
        print(
            f"[{i}] avail={avail}MiB gpu={gpu}MiB status={status} "
            f"prog={prog} phase={phase} msg={msg}"
        )

        if status == "done":
            glb = st.get("glb_url") or f"/view/{st.get('out_id', out_id)}.glb"
            download(glb, WORK)
            OUT.write_bytes(WORK.read_bytes())
            print(f"SUCCESS {OUT} ({OUT.stat().st_size} bytes)")
            return 0
        if status in ("error", "cancelled"):
            print(json.dumps(st, indent=2))
            return 1

        if isinstance(prog, (int, float)) and prev >= 0 and prog < prev:
            regress += 1
            print(f"REGRESS {prev}->{prog} (#{regress})")
            if regress >= REGRESS_LIMIT:
                print("Abort death loop")
                subprocess.run(["sudo", "systemctl", "stop", "podman-trellis3d"], check=False)
                clear_queue()
                return 3
        if isinstance(prog, (int, float)) and prog > prev:
            prev = int(prog)
            regress = 0

        if avail >= 0 and avail < 800 and (prog is None or prog <= 45):
            print(f"WARN critically low MemAvailable during load: {avail}MiB")

        time.sleep(POLL_S)

    print("TIMEOUT")
    return 4


if __name__ == "__main__":
    raise SystemExit(main())
