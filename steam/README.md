# Steam pipeline stubs (S4)

| Plik | Rola |
|------|------|
| `steam_appid.txt` | Dev stub AppID **480** (Spacewar). Po S4.1 → prawdziwy ID. |
| `app_build.vdf.example` | Szablon depotu — skopiuj na `app_build.vdf` po utworzeniu depots. |
| `../scripts/steam-upload-depot.sh` | Szkielet uploadu (`npm run steam:upload`). |

**Adam (lead time, nie czekaj na kod):**
1. Steam Direct / partner → AppID
2. Code Signing OV ([`docs/CODE-SIGNING.md`](../docs/CODE-SIGNING.md))
3. Pitch / shoty: [`docs/STORE-PITCH.md`](../docs/STORE-PITCH.md)
