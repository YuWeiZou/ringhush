#!/usr/bin/env python3
"""Listwise candidate ranker: softmax over all legal candidates per state.

This directly optimizes top-1 action choice, unlike independent BCE on sampled
negatives. Data comes from collect_ranker.mjs --negatives=all.
"""
import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=str(HERE / "data" / "apex-g2.jsonl"))
    p.add_argument("--out", default=str(ROOT / "ai" / "models" / "apex.weights.json"))
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--hidden", default="128,64")
    p.add_argument("--seed", type=int, default=11)
    p.add_argument("--val-ratio", type=float, default=0.2)
    return p.parse_args()


class Ranker(nn.Module):
    def __init__(self, input_dim, hidden):
        super().__init__()
        layers = []
        last = input_dim
        for size in hidden:
            layers += [nn.Linear(last, size), nn.ReLU()]
            last = size
        layers += [nn.Linear(last, 1)]
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


def load_states(path):
    groups = defaultdict(list)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            groups[(row["g"], row.get("p"), row["r"])].append(row)
    states = []
    for key, items in groups.items():
        pos = [i for i, r in enumerate(items) if r["y"] == 1]
        if len(pos) != 1:
            continue
        x = torch.tensor([r["x"] for r in items], dtype=torch.float32)
        states.append({"g": key[0], "x": x, "y": pos[0]})
    return states


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    states = load_states(args.data)
    games = sorted({s["g"] for s in states})
    random.Random(13).shuffle(games)
    cut = max(1, int(len(games) * args.val_ratio))
    val_games = set(games[:cut])
    train = [s for s in states if s["g"] not in val_games]
    val = [s for s in states if s["g"] in val_games]
    hidden = [int(x) for x in args.hidden.split(",") if x.strip()]
    model = Ranker(58, hidden)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()
    best = None
    history = []

    for epoch in range(1, args.epochs + 1):
        random.shuffle(train)
        total_loss = 0.0
        n_states = 0
        for start in range(0, len(train), args.batch):
            batch = train[start:start + args.batch]
            opt.zero_grad(set_to_none=True)
            losses = []
            for state in batch:
                scores = model(state["x"])
                losses.append(loss_fn(scores.unsqueeze(0), torch.tensor([state["y"]])))
            loss = torch.stack(losses).mean()
            loss.backward()
            opt.step()
            total_loss += float(loss.detach()) * len(batch)
            n_states += len(batch)
        model.eval()
        with torch.no_grad():
            correct = 0
            for state in val:
                scores = model(state["x"])
                correct += int(int(torch.argmax(scores).item()) == state["y"])
        top1 = correct / max(1, len(val))
        rec = {
            "epoch": epoch,
            "loss": total_loss / max(1, n_states),
            "val_top1": top1,
            "val_states": len(val),
        }
        history.append(rec)
        print(json.dumps(rec, ensure_ascii=False))
        if best is None or top1 > best["val_top1"]:
            best = dict(rec)
            best["state_dict"] = {k: v.detach().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best["state_dict"])
    layers = []
    sd = model.state_dict()
    linear_names = [k for k in sd if k.endswith(".weight")]
    for name in linear_names:
        w = sd[name].detach().cpu().tolist()
        b = sd[name.replace(".weight", ".bias")].detach().cpu().tolist()
        layers.append({"w": w, "b": b})
    payload = {
        "schema": 1,
        "name": "apex",
        "kind": "candidate-ranker-listwise",
        "featureDim": 58,
        "hidden": hidden,
        "layers": layers,
        "trainedAt": "2026-10-22",
        "data": str(Path(args.data).name),
        "states": len(states),
        "valTop1": best["val_top1"],
        "valStates": len(val),
        "seed": args.seed,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    metrics = out.with_suffix(".metrics.json")
    metrics.write_text(json.dumps({"best": {k: v for k, v in best.items() if k != "state_dict"}, "history": history}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} best_top1={best['val_top1']:.3f}")


if __name__ == "__main__":
    main()
