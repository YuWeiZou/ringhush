#!/usr/bin/env bash
set -euo pipefail
cd /mnt/d/stuff/DSH/001/黑暗森林
export HSA_ENABLE_DXG_DETECTION=1
for seed in 7 17 27; do
  echo "===== seed ${seed} ====="
  ~/gsv/bin/python ai/train/train_iter.py \
    --data ai/train/data/decisions-v2.jsonl \
    --epochs 120 \
    --hidden 256 \
    --patience 20 \
    --seed "${seed}" \
    --out "ai/train/checkpoints/policy-v2-seed${seed}.pt"
done
echo "ALL SEEDS DONE"
