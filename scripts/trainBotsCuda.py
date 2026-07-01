#!/usr/bin/env python3
"""
GPU (CUDA) pre-trening polityki botów Ignite — eksport do bot-policy.json.

Uproszczona symulacja 2D na GPU (proxy fitness). Po treningu dopracuj pełny stack:
  npm run train:bots

Zmienne:
  CUDA_TRAIN_GENS      (24)
  CUDA_TRAIN_POP       (48)
  CUDA_TRAIN_EPISODES  (32)  — równoległe epizody na politykę
  CUDA_TRAIN_STEPS     (300) — kroków 60 Hz na epizod
  CUDA_TRAIN_OUT       — ścieżka wyjścia
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
from pathlib import Path

try:
    import torch
    import torch.nn as nn
except ImportError:
    print("Brak PyTorch. Użyj env z torch+cuda.", file=sys.stderr)
    sys.exit(1)

INPUT = 18
HIDDEN = 20
OUTPUT = 4
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public/assets/ai/bot-policy.json"


class PolicyMLP(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(INPUT, HIDDEN)
        self.fc2 = nn.Linear(HIDDEN, OUTPUT)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.tanh(self.fc2(torch.tanh(self.fc1(x))))


def policy_to_json(model: PolicyMLP, generation: int, fitness: float) -> dict:
    w1 = model.fc1.weight.detach().cpu().reshape(-1).tolist()
    b1 = model.fc1.bias.detach().cpu().tolist()
    w2 = model.fc2.weight.detach().cpu().reshape(-1).tolist()
    b2 = model.fc2.bias.detach().cpu().tolist()
    return {
        "version": 1,
        "generation": generation,
        "fitness": float(fitness),
        "w1": w1,
        "b1": b1,
        "w2": w2,
        "b2": b2,
    }


def load_policy_into(model: PolicyMLP, path: Path) -> float:
    if not path.is_file():
        return -1e9
    data = json.loads(path.read_text(encoding="utf-8"))
    with torch.no_grad():
        model.fc1.weight.copy_(torch.tensor(data["w1"], dtype=torch.float32).view(HIDDEN, INPUT))
        model.fc1.bias.copy_(torch.tensor(data["b1"], dtype=torch.float32))
        model.fc2.weight.copy_(torch.tensor(data["w2"], dtype=torch.float32).view(OUTPUT, HIDDEN))
        model.fc2.bias.copy_(torch.tensor(data["b2"], dtype=torch.float32))
    return float(data.get("fitness", -1e9))


@torch.no_grad()
def evaluate_policy(
    model: PolicyMLP,
    device: torch.device,
    episodes: int,
    steps: int,
) -> float:
    """Batched proxy sim — nagroda za zbliżanie się do piłki i pchnięcie w stronę bramki."""
    model.eval()
    total = torch.zeros((), device=device)
    goal = torch.tensor([0.0, 28.0], device=device)

    for _ in range(episodes):
        car = torch.tensor(
            [[random.uniform(-4, 4), random.uniform(-26, -20)]],
            device=device,
            dtype=torch.float32,
        )
        ball = torch.tensor(
            [[random.uniform(-8, 8), random.uniform(-6, 6)]],
            device=device,
            dtype=torch.float32,
        )
        car_v = torch.zeros(1, 2, device=device)
        ball_v = torch.zeros(1, 2, device=device)
        ep_reward = torch.zeros((), device=device)

        for _t in range(steps):
            to_ball = ball - car
            to_goal = goal.unsqueeze(0) - ball
            dist_ball = torch.linalg.norm(to_ball, dim=1, keepdim=True).clamp(min=1e-3)
            dist_goal = torch.linalg.norm(to_goal, dim=1, keepdim=True).clamp(min=1e-3)

            obs = torch.cat(
                [
                    to_ball / 40.0,
                    ball_v / 20.0,
                    car_v / 20.0,
                    to_goal / 40.0,
                    ball_v / 20.0,
                    torch.zeros(1, 4, device=device),
                ],
                dim=1,
            )[:, :INPUT]

            act = model(obs).squeeze(0)
            thrust = torch.tensor([act[0].item(), act[1].item()], device=device)
            thrust = thrust / (torch.linalg.norm(thrust) + 1e-3)
            car_v = car_v.squeeze(0) * 0.94 + thrust * 0.55
            car = car.squeeze(0) + car_v * (1.0 / 60.0)
            car = car.unsqueeze(0)
            car_v = car_v.unsqueeze(0)

            hit = dist_ball.squeeze() < 2.2
            if hit:
                push = (to_goal.squeeze() / dist_goal.squeeze()) * 0.35
                ball_v = ball_v.squeeze(0) + push + car_v.squeeze(0) * 0.25
                ball_v = ball_v.unsqueeze(0)
                ep_reward = ep_reward + 1.8

            ball = ball + ball_v * (1.0 / 60.0)
            ball_v = ball_v * 0.992

            ep_reward = ep_reward + (1.4 / dist_ball.squeeze()) * 0.02
            ep_reward = ep_reward + (
                (ball_v.squeeze() * to_goal.squeeze()).sum() / dist_goal.squeeze()
            ) * 0.01

            if ball.squeeze()[1] > 27.5:
                ep_reward = ep_reward + 6.0
                break

        total = total + ep_reward

    return float((total / episodes).item())


def mutate(model: PolicyMLP, rate: float = 0.12, scale: float = 0.28) -> PolicyMLP:
    child = PolicyMLP().to(next(model.parameters()).device)
    child.load_state_dict(model.state_dict())
    with torch.no_grad():
        for p in child.parameters():
            mask = torch.rand_like(p) < rate
            p.add_(mask * (torch.rand_like(p) * 2 - 1) * scale)
    return child


def crossover(a: PolicyMLP, b: PolicyMLP) -> PolicyMLP:
    child = PolicyMLP().to(next(a.parameters()).device)
    with torch.no_grad():
        for (na, pa), (nb, pb), (_, pc) in zip(a.named_parameters(), b.named_parameters(), child.named_parameters()):
            pick = torch.rand_like(pa) > 0.5
            pc.copy_(torch.where(pick, pa, pb))
    return mutate(child, rate=0.06, scale=0.18)


def main() -> None:
    gens = int(os.environ.get("CUDA_TRAIN_GENS", "24"))
    pop_size = int(os.environ.get("CUDA_TRAIN_POP", "48"))
    episodes = int(os.environ.get("CUDA_TRAIN_EPISODES", "32"))
    steps = int(os.environ.get("CUDA_TRAIN_STEPS", "300"))
    out_path = Path(os.environ.get("CUDA_TRAIN_OUT", str(DEFAULT_OUT)))
    elite = max(2, pop_size // 5)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[cuda-train] device={device} pop={pop_size} gens={gens} episodes={episodes}")

    seed = PolicyMLP().to(device)
    seed_fit = load_policy_into(seed, out_path)
    population = [seed]
    while len(population) < pop_size:
        population.append(mutate(seed))

    best = seed
    best_fit = seed_fit if seed_fit > -1e8 else -1e9
    t0 = time.time()

    for gen in range(1, gens + 1):
        scored: list[tuple[float, PolicyMLP]] = []
        for i, policy in enumerate(population):
            fit = evaluate_policy(policy, device, episodes, steps)
            scored.append((fit, policy))
            if fit > best_fit:
                best_fit = fit
                best = policy

        scored.sort(key=lambda x: x[0], reverse=True)
        avg = sum(s for s, _ in scored) / len(scored)
        print(
            f"[cuda-train] gen {gen}/{gens} best={scored[0][0]:.2f} "
            f"avg={avg:.2f} elapsed={time.time() - t0:.1f}s"
        )

        next_pop = [scored[i][1] for i in range(elite)]
        while len(next_pop) < pop_size:
            a = random.choice(scored[: max(elite, pop_size // 2)])[1]
            b = random.choice(scored[: max(elite, pop_size // 2)])[1]
            next_pop.append(crossover(a, b))
        population = next_pop

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = policy_to_json(best, gens, best_fit)
    out_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"[cuda-train] zapisano {out_path} fitness={best_fit:.2f}")
    print("[cuda-train] dopracuj: npm run train:bots (pełna fizyka Rapier)")


if __name__ == "__main__":
    main()
