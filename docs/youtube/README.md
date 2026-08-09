# YouTube kit — Ignite

## Status

Prywatny kanał `@adam_em2820` / Adam_eM — **cofnięty** (nazwa + opis).

Kanał gry: **osobne konto Google** (nie prywatne). Robimy po kolei.

### Krok 1 (Ty)
Załóż osobne konto Google pod grę, np. `ignite.game@gmail.com`.  
Zaloguj je w Vivaldi (najlepiej osobny profil przeglądarki).

### Krok 2
Daj znać — ustawię kanał **Ignite Game** + opis + avatar/banner z `assets/`.

## Pliki

| Plik | Co to |
|------|--------|
| [CHANNEL.md](./CHANNEL.md) | Opisy PL/EN, linki |
| [VIDEOS.md](./VIDEOS.md) | Pierwsze 5 filmów |
| [TRAILER.md](./TRAILER.md) | Skrypt trailera |
| [CHECKLIST.md](./CHECKLIST.md) | Checklista |
| `assets/avatar-logo.png` | Avatar |
| `assets/banner-youtube.jpg` | Banner (&lt;4 MB) |

## Skrypty (później, na koncie gry)

```bash
bash scripts/youtube/open-vivaldi-cdp.sh --restart
npm run youtube:setup-channel
node scripts/youtube/applyBranding.mjs
```
