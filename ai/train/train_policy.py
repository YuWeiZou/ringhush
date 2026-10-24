#!/usr/bin/env python3
"""AI 2.0 behavior-cloning baseline.

This is intentionally a *baseline*: it learns to imitate the heuristic
AI 2.0 action type from the AI's own view. It is not wired into the game yet.
The point is to prove the local ROCm/PyTorch GPU training loop end-to-end.

Usage (WSL2 + ROCm):
  HSA_ENABLE_DXG_DETECTION=1 ~/gsv/bin/python ai/train/train_policy.py
"""
import argparse
import json
import os
import random
from pathlib import Path

os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")

import torch
import torch.nn as nn
import torch.optim as optim

HERE = Path(__file__).resolve().parent
TYPES = ["hide", "observe", "attack", "slip"]
TYPE_TO_ID = {t: i for i, t in enumerate(TYPES)}


def features(row):
    s = int(row["S"])
    pos = int(row["mePos"])
    x = [0.0] * (87)
    k = 0
    x[k] = min(1.0, row["round"] / 100.0); k += 1
    x[k] = min(1.0, row["alive"] / 8.0); k += 1
    x[k] = min(1.0, s / 25.0); k += 1
    if 0 <= pos < 25:
        x[k + pos] = 1.0
    k += 25
    terrain = row.get("meTerrain")
    if terrain == "plain":
        x[k] = 1.0
    elif terrain == "pillar":
        x[k + 1] = 1.0
    elif terrain == "ruins":
        x[k + 2] = 1.0
    k += 3
    for t in row.get("bombTargets") or []:
        if 0 <= int(t) < 25:
            x[k + int(t)] = 1.0
    k += 25
    for t in row.get("known") or []:
        if 0 <= int(t) < 25:
            x[k + int(t)] = 1.0
    k += 25
    sound = row.get("sound") or {}
    x[k] = min(1.0, float(sound.get("left", 0)) / 5.0); k += 1
    x[k] = min(1.0, float(sound.get("right", 0)) / 5.0); k += 1
    x[k] = 1.0 if row.get("canHide") else 0.0; k += 1
    x[k] = 1.0 if row.get("canHideEffective") else 0.0; k += 1
    x[k] = 1.0 if row.get("observeFull") else 0.0; k += 1
    x[k] = min(1.0, float(row.get("bombRound") or 0) / 100.0); k += 1
    assert k == len(x), (k, len(x))
    return x


def load_rows(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            t = r.get("action", {}).get("type")
            if t not in TYPE_TO_ID:
                continue
            rows.append(r)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "data" / "decisions.jsonl"))
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--out", default=str(HERE / "checkpoints" / "policy.pt"))
    args = ap.parse_args()

    rows = load_rows(args.data)
    if not rows:
        raise SystemExit(f"no rows: {args.data}")

    # Game-level split avoids rows from the same match leaking into both sides.
    games = sorted({r["game"] for r in rows})
    random.Random(7).shuffle(games)
    cut = max(1, int(len(games) * 0.8))
    train_games = set(games[:cut])
    train_rows = [r for r in rows if r["game"] in train_games]
    val_rows = [r for r in rows if r["game"] not in train_games]
    if not val_rows:
        val_rows = train_rows[-max(1, len(train_rows) // 10):]

    def tensor(rs):
        x = torch.tensor([features(r) for r in rs], dtype=torch.float32)
        y = torch.tensor([TYPE_TO_ID[r["action"]["type"]] for r in rs], dtype=torch.long)
        return x, y

    xtr, ytr = tensor(train_rows)
    xva, yva = tensor(val_rows)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"torch={torch.__version__} device={device}")
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)} count={torch.cuda.device_count()}")
    print(f"rows={len(rows)} train={len(train_rows)} val={len(val_rows)} games={len(games)}")
    print("labels:", {t: sum(1 for r in rows if r["action"]["type"] == t) for t in TYPES})

    model = nn.Sequential(
        nn.Linear(87, 128),
        nn.ReLU(),
        nn.Dropout(0.1),
        nn.Linear(128, 128),
        nn.ReLU(),
        nn.Linear(128, len(TYPES)),
    ).to(device)
    opt = optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()

    xva, yva = xva.to(device), yva.to(device)
    best_acc = 0.0
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(xtr))
        total_loss = 0.0
        for i in range(0, len(perm), args.batch):
            idx = perm[i:i + args.batch]
            xb, yb = xtr[idx].to(device), ytr[idx].to(device)
            opt.zero_grad(set_to_none=True)
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            opt.step()
            total_loss += float(loss.detach()) * len(idx)
        model.eval()
        with torch.no_grad():
            logits = model(xva)
            acc = float((logits.argmax(1) == yva).float().mean())
            val_loss = float(loss_fn(logits, yva))
        avg_loss = total_loss / max(1, len(xtr))
        history.append({"epoch": epoch, "loss": avg_loss, "val_loss": val_loss, "val_acc": acc})
        print(f"epoch {epoch:02d} loss={avg_loss:.4f} val_loss={val_loss:.4f} val_acc={acc:.3f}")
        if acc > best_acc:
            best_acc = acc
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            torch.save({"state_dict": model.state_dict(), "types": TYPES, "input_dim": 87}, args.out)

    metrics = {
        "torch": torch.__version__,
        "hip": getattr(torch.version, "hip", None),
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "rows": len(rows),
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "best_val_acc": best_acc,
        "history": history,
        "labels": {t: sum(1 for r in rows if r["action"]["type"] == t) for t in TYPES},
    }
    out_metrics = Path(args.out).with_suffix(".metrics.json")
    out_metrics.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {args.out}")
    print(f"metrics {out_metrics}")


if __name__ == "__main__":
    main()
