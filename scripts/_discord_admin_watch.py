#!/usr/bin/env python3
"""Tymczasowy watcher: Admin dla zaproszonych po dołączeniu (max 6h)."""
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = Path("/tmp/ignite-watch-token").read_text().strip()
UA = "Mozilla/5.0 discord/1.0"


def api(method, path, body=None):
	data = None if body is None else json.dumps(body).encode()
	req = urllib.request.Request(
		"https://discord.com/api/v9" + path,
		data=data,
		method=method,
		headers={
			"Authorization": TOKEN,
			"Content-Type": "application/json",
			"User-Agent": UA,
		},
	)
	try:
		with urllib.request.urlopen(req, timeout=30) as r:
			raw = r.read()
			return r.status, json.loads(raw) if raw else None
	except urllib.error.HTTPError as e:
		raw = e.read().decode()
		try:
			return e.code, json.loads(raw)
		except Exception:
			return e.code, raw


meta = json.loads(Path.home().joinpath(".config/ignite/discord-server.json").read_text())
guild = meta["guildId"]
# Wszyscy, którzy już dostali DM z invite — zostają.
INVITEES = [
	("1467038772255522837", "Bielique"),
	("274204283694612480", "XenoiX"),
	("778072058890289192", "xhavsky"),
	("1165221935869857853", "Ben"),
	("1264993526010347648", "Salsa"),
	("1341851092887015535", "Pchełka"),
	("668009092085841930", "netkiller"),
	("486588675652583424", "Aragorn"),
]
_code, roles = api("GET", f"/guilds/{guild}/roles")
admin_role = next(r["id"] for r in roles if r["name"] == "Admin")
done: set[str] = set()
deadline = time.time() + 6 * 3600
print("watch start", time.ctime(), "guild", guild, flush=True)
while time.time() < deadline and len(done) < len(INVITEES):
	for uid, name in INVITEES:
		if name in done:
			continue
		code, m = api("GET", f"/guilds/{guild}/members/{uid}")
		if code != 200 or not isinstance(m, dict) or "user" not in m:
			continue
		roles_now = m.get("roles") or []
		if admin_role not in roles_now:
			new = list(dict.fromkeys(roles_now + [admin_role]))
			code, _r = api("PATCH", f"/guilds/{guild}/members/{uid}", {"roles": new})
			print(time.ctime(), "assign", name, code, flush=True)
		else:
			print(time.ctime(), "already", name, flush=True)
		done.add(name)
	time.sleep(30)
print("watch end", time.ctime(), "done", sorted(done), flush=True)
