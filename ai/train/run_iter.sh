#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/stuff/DSH/001/黑暗森林
export HSA_ENABLE_DXG_DETECTION=1
~/gsv/bin/python ai/train/train_iter.py \
  --data ai/train/data/decisions-v2.jsonl \
  --epochs 180 \
  --hidden 256 \
  --patience 24 \
  --out ai/train/checkpoints/policy-v2.pt
