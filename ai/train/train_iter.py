#!/usr/bin/env python3
"""AI 2.0 iterative behavior-cloning run.

Usage:
  HSA_ENABLE_DXG_DETECTION=1 ~/gsv/bin/python ai/train/train_iter.py \
    --data ai/train/data/decisions-v2.jsonl --epochs 120 --hidden 256
"""
import argparse
import json
import random
import os
from pathlib import Path

os.environ.setdefault("HSA_ENABLE_DXG_DETECTION", "1")

import torch
import torch.nn as nn
import torch.optim as optim

from train_policy import TYPES, TYPE_TO_ID, features, load_rows

HERE = Path(__file__).resolve().parent


def confusion_matrix(y_true, y_pred, n=len(TYPES)):
    cm = [[0] * n for _ in range(n)]
    for t, p in zip(y_true.tolist(), y_pred.tolist()):
        cm[t][p] += 1
    return cm


def macro_f1(cm):
    f1s = []
    for i in range(len(cm)):
        tp = cm[i][i]
        fp = sum(cm[r][i] for r in range(len(cm))) - tp
        fn = sum(cm[i]) - tp
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1s.append(f1)
    return sum(f1s) / len(f1s), f1s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "data" / "decisions-v2.jsonl"))
    ap.add_argument("--epochs", type=int, default=120)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--hidden", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--patience", type=int, default=18)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(HERE / "checkpoints" / "policy-v2.pt"))
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    rows = load_rows(args.data)
    if not rows:
        raise SystemExit(f"no rows: {args.data}")

    games = sorted({r["game"] for r in rows})
    random.Random(args.seed).shuffle(games)
    cut = max(1, int(len(games) * 0.8))
    train_games = set(games[:cut])
    train_rows = [r for r in rows if r["game"] in train_games]
    val_rows = [r for r in rows if r["game"] not in train_games]
    if not val_rows:
        val_rows = train_rows[-max(1, len(train_rows) // 10):]

    xtr = torch.tensor([features(r) for r in train_rows], dtype=torch.float32)
    ytr = torch.tensor([TYPE_TO_ID[r["action"]["type"]] for r in train_rows], dtype=torch.long)
    xva = torch.tensor([features(r) for r in val_rows], dtype=torch.float32)
    yva = torch.tensor([TYPE_TO_ID[r["action"]["type"]] for r in val_rows], dtype=torch.long)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"torch={torch.__version__} hip={getattr(torch.version, 'hip', None)} device={device}")
    if device.type == "cuda":
        print(f"gpu={torch.cuda.get_device_name(0)} count={torch.cuda.device_count()}")
    type_counts = {t: sum(1 for r in rows if r["action"]["type"] == t) for t in TYPES}
    print(f"rows={len(rows)} train={len(train_rows)} val={len(val_rows)} games={len(games)}")
    print("labels:", type_counts)

    weights = []
    total = sum(type_counts.values())
    for t in TYPES:
        c = max(1, type_counts[t])
        weights.append((total / (len(TYPES) * c)) ** 0.5)
    weight_t = torch.tensor(weights, dtype=torch.float32, device=device)
    print("class weights:", {t: round(w, 3) for t, w in zip(TYPES, weights)})

    model = nn.Sequential(
        nn.Linear(87, args.hidden),
        nn.ReLU(),
        nn.Dropout(0.15),
        nn.Linear(args.hidden, args.hidden),
        nn.ReLU(),
        nn.Dropout(0.15),
        nn.Linear(args.hidden, len(TYPES)),
    ).to(device)
    opt = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=2e-4)
    scheduler = optim.lr_scheduler.ReduceLROnPlateau(opt, mode="min", factor=0.5, patience=6)
    loss_fn = nn.CrossEntropyLoss(weight=weight_t, label_smoothing=0.03)

    xva, yva = xva.to(device), yva.to(device)
    best = {"val_loss": 1e9, "epoch": 0, "acc": 0.0, "macro_f1": 0.0}
    stale = 0
    history = []
    for epoch in range(1, args.epochs + 1):
        model.train()
        perm = torch.randperm(len(xtr))
        total_loss = 0.0
        for i in range(0, len(perm), args.batch):
            idx = perm[i:i + args.batch]
            xb = xtr[idx].to(device)
            yb = ytr[idx].to(device)
            opt.zero_grad(set_to_none=True)
            out = model(xb)
            loss = loss_fn(out, yb)
            loss.backward()
            opt.step()
            total_loss += float(loss.detach()) * len(idx)
        model.eval()
        with torch.no_grad():
            logits = model(xva)
            val_loss = float(loss_fn(logits, yva).detach())
            pred = logits.argmax(1)
            acc = float((pred == yva).float().mean())
            cm = confusion_matrix(yva.cpu(), pred.cpu())
            mf1, per_class = macro_f1(cm)
        scheduler.step(val_loss)
        avg_loss = total_loss / max(1, len(xtr))
        history.append(
            {
                "epoch": epoch,
                "loss": avg_loss,
                "val_loss": val_loss,
                "val_acc": acc,
                "macro_f1": mf1,
                "per_class_f1": {t: round(v, 3) for t, v in zip(TYPES, per_class)},
            }
        )
        print(
            f"epoch {epoch:03d} loss={avg_loss:.4f} val_loss={val_loss:.4f} "
            f"acc={acc:.3f} macro_f1={mf1:.3f}",
            flush=True,
        )
        if val_loss < best["val_loss"]:
            best = {"val_loss": val_loss, "epoch": epoch, "acc": acc, "macro_f1": mf1}
            stale = 0
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "types": TYPES,
                    "input_dim": 87,
                    "hidden": args.hidden,
                    "metrics": best,
                },
                args.out,
            )
        else:
            stale += 1
            if stale >= args.patience:
                print(f"early stop at epoch {epoch}; best epoch {best['epoch']}")
                break

    metrics = {
        "torch": torch.__version__,
        "hip": getattr(torch.version, "hip", None),
        "device": str(device),
        "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
        "rows": len(rows),
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "games": len(games),
        "types": TYPES,
        "labels": type_counts,
        "class_weights": {t: round(w, 4) for t, w in zip(TYPES, weights)},
        "best": best,
        "history": history,
    }
    out_metrics = Path(args.out).with_suffix(".metrics.json")
    out_metrics.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"BEST epoch={best['epoch']} acc={best['acc']:.3f} macro_f1={best['macro_f1']:.3f}")
    print(f"saved {args.out}")
    print(f"metrics {out_metrics}")


if __name__ == "__main__":
    main()
