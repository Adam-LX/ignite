# Ignite — Godot 4 port

Testowy port fizyki Rocket League z Three.js/Rapier do Godot 4 (GDScript).

## Uruchomienie

```bash
# z Nix devShell (godot_4 w PATH):
nix develop -c ./godot/ignite/run.sh

# test headless (8s, bez okna):
nix develop -c ./godot/ignite/run.sh --headless-test

# lub bezpośrednio:
cd godot/ignite && godot --path .
```

## Sterowanie

| Wejście | Akcja |
|---------|--------|
| W/S/A/D | Gaz / skręt / pitch-yaw w locie |
| Q/E | Roll (beczka) |
| LPM | Boost |
| PPM | Skok / recovery z dachu |
| Spacja | Ball Cam toggle |

## Struktura

- `scripts/physics/rocket_car.gd` — zawieszenie raycast, skok, aerial, śruba w pionie
- `scripts/camera/rocket_camera.gd` — kamera chase (flat XZ forward)
- `scripts/ai/rocket_bot_ai.gd` — FSM bot + intercept + front flip dodge
- `scripts/autoload/rl_constants.gd` — stałe RL (autoload)

## Konwencja osi Godot

- **-Z** = przód auta
- **+Y** = góra
- **+X** = prawo

Aerial control aktywny gdy `wheels_grounded < 2`. Tłumienie kątowe w locie: `angular_damp = 10.0` (brak inputu) / `0.0` (input).

## Fizyka

`project.godot`: `physics_ticks_per_second = 120`, `gravity = 6.5 m/s²`.
