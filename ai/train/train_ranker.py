#!/usr/bin/env python3
"""Train a candidate-action ranker that imitates adaptive.

Input: JSONL rows {g,r,y,t,x:[58]} from collect_ranker.mjs.
Output: ai/models/apex.weights.json (small MLP, pure JSON).
"""
import argparse
import json
import math
import random
import hashlib
from collections import defaultdict
from pathlib import Path

import torch
import torch.nn as nn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=str(HERE / "data" / "apex-ranker.jsonl"))
    p.add_argument("--out", default=str(ROOT / "ai" / "models" / "apex.weights.json"))
    p.add_argument("--epochs", type=int, default=18)
    p.add_argument("--batch", type=int, default=4096)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--hidden", default="128,64")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--val-ratio", type=float, default=0.2)
    p.add_argument("--pos-weight", type=float, default=7.0)
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


def load_rows(path):
    rows = []
    groups = defaultdict(list)
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            x = row["x"]
            if len(x) != 58:
                raise ValueError(f"bad feature dim {len(x)}")
            rows.append(row)
            groups[(row["g"], row["r"], row.get("p"))].append(row)
    return rows, groups


def split_games(rows, val_ratio):
    games = sorted({r["g"] for r in rows})
    random.Random(13).shuffle(games)
    cut = max(1, int(len(games) * val_ratio))
    val_games = set(games[:cut])
    train = [r for r in rows if r["g"] not in val_games]
    val = [r for r in rows if r["g"] in val_games]
    return train, val, val_games


def tensor_rows(rows):
    x = torch.tensor([r["x"] for r in rows], dtype=torch.float32)
    y = torch.tensor([float(r["y"]) for r in rows], dtype=torch.float32)
    return x, y


def group_top1(rows, model):
    groups = defaultdict(list)
    for r in rows:
        groups[(r["g"], r["r"], r.get("p"))].append(r)
    correct = 0
    total = 0
    with torch.no_grad():
        for items in groups.values():
            # Only evaluate groups that contain exactly one positive.
            pos = [r for r in items if r["y"] == 1]
            if len(pos) != 1:
                continue
            x = torch.tensor([r["x"] for r in items], dtype=torch.float32)
            scores = model(x)
            best = int(torch.argmax(scores).item())
            expected = items.index(pos[0])
            correct += int(best == expected)
            total += 1
    return correct / max(1, total), total


def main():
    args = parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    rows, _ = load_rows(args.data)
    if not rows:
        raise SystemExit("no rows")
    train_rows, val_rows, val_games = split_games(rows, args.val_ratio)
    xtr, ytr = tensor_rows(train_rows)
    xva, yva = tensor_rows(val_rows)
    hidden = [int(x) for x in args.hidden.split(",") if x.strip()]
    model = Ranker(58, hidden)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor(args.pos_weight))
    n = len(xtr)
    best = None
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(n)
        total_loss = 0.0
        for i in range(0, n, args.batch):
            idx = perm[i:i + args.batch]
            opt.zero_grad(set_to_none=True)
            out = model(xtr[idx])
            loss = loss_fn(out, ytr[idx])
            loss.backward()
            opt.step()
            total_loss += float(loss.detach()) * len(idx)
        model.eval()
        with torch.no_grad():
            logits = model(xva)
            val_loss = float(loss_fn(logits, yva))
            acc = float(((logits > 0) == yva.bool()).float().mean())
        top1, groups = group_top1(val_rows, model)
        avg_loss = total_loss / max(1, n)
        rec = {
            "epoch": epoch,
            "loss": avg_loss,
            "val_loss": val_loss,
            "val_acc": acc,
            "val_top1": top1,
            "val_groups": groups,
        }
        history.append(rec)
        print(json.dumps(rec, ensure_ascii=False))
        if best is None or top1 > best["val_top1"] or (top1 == best["val_top1"] and val_loss < best["val_loss"]):
            best = dict(rec)
            best["state_dict"] = {k: v.detach().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best["state_dict"])
    # Export only the MLP; the JS runner implements Linear+ReLU+Linear.
    layers = []
    sd = model.state_dict()
    linear_names = [k for k in sd if k.endswith(".weight")]
    for i, name in enumerate(linear_names):
        w = sd[name].detach().cpu().tolist()
        b = sd[name.replace(".weight", ".bias")].detach().cpu().tolist()
        layers.append({"w": w, "b": b})
    payload = {
        "schema": 1,
        "name": "apex",
        "kind": "candidate-ranker",
        "featureDim": 58,
        "hidden": hidden,
        "layers": layers,
        "trainedAt": "2026-10-22",
        "data": str(Path(args.data).name),
        "rows": len(rows),
        "states": len({(r["g"], r["r"], r.get("p")) for r in rows}),
        "valTop1": best["val_top1"],
        "valAcc": best["val_acc"],
        "valGames": len(val_games),
        "seed": args.seed,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    metrics = Path(args.out).with_suffix(".metrics.json")
    metrics.write_text(json.dumps({"best": {k: v for k, v in best.items() if k != "state_dict"}, "history": history}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out} best_top1={best['val_top1']:.3f} acc={best['val_acc']:.3f}")


if __name__ == "__main__":
    main()
