# Ignite — pobieranie

Binaria na **GitHub Releases** (bez limitu LFS). Kod gry: [Codeberg](https://codeberg.org/Adam-LX/ignite) · [README.md](README.md).

## Download

| Platforma | Plik | Rozmiar |
|-----------|------|---------|
| **Windows** | [Ignite-0.3.39-win64.zip](https://github.com/Adam-LX/ignite-releases/releases/download/v0.3.39/Ignite-0.3.39-win64.zip) | ~542 MB |
| **Ubuntu / Debian** | [Ignite-0.3.39-linux-amd64.deb](https://github.com/Adam-LX/ignite-releases/releases/download/v0.3.39/Ignite-0.3.39-linux-amd64.deb) | ~488 MB |
| **Linux AppImage** | [Ignite-0.3.39-linux-amd64.AppImage](https://github.com/Adam-LX/ignite-releases/releases/download/v0.3.39/Ignite-0.3.39-linux-amd64.AppImage) | ~477 MB |
| **Steam Deck** | [Ignite-0.3.39-SteamDeck.run](https://github.com/Adam-LX/ignite-releases/releases/download/v0.3.39/Ignite-0.3.39-SteamDeck.run) | ~477 MB |

> Flatpak (.flatpak) wróci w kolejnej paczce — w 0.3.39 użyj AppImage / .deb.

### Kod źródłowy
Repozytorium git na [Codeberg](https://codeberg.org/Adam-LX/ignite) — archiwum `.tar.zst` nie jest publikowane (tylko lokalny eksport: `./scripts/publish-codeberg.sh source`).

### Windows
1. Pobierz zip → **Wypakuj cały folder**
2. Uruchom **Ignite.exe** — **nie wymaga admina**
3. **F11** — fullscreen · **Esc** — pauza
4. SmartScreen (brak podpisu) → „Więcej informacji” → „Uruchom mimo to”

### Linux (.deb)
```bash
sudo dpkg -i Ignite-0.3.39-linux-amd64.deb
sudo apt -f install
ignite
```

### Linux (AppImage)
```bash
chmod +x Ignite-0.3.39-linux-amd64.AppImage
./Ignite-0.3.39-linux-amd64.AppImage
```

### Steam Deck
```bash
chmod +x Ignite-0.3.39-SteamDeck.run
./Ignite-0.3.39-SteamDeck.run
```
Pierwsze uruchomienie rozpakowuje grę do `~/.local/share/ignite/`. Dodaj `.run` do Steam jako grę spoza Steam.

[GitHub Releases](https://github.com/Adam-LX/ignite-releases/releases/tag/v0.3.39)
