# AI Training (WSL2 + ROCm + PyTorch)

> English | [中文](./README.md)

This is AI 2.0's **starting point for training**, not the final policy.

Current flow:

1. Collect decision data with AI 2.0 self-play;
2. Train a small behavior-cloning network with ROCm PyTorch inside WSL2;
3. Verify that the 7900 XTX really takes part in training;
4. Record the baseline, and next do self-play/reinforcement learning or wire the network back into the game.

## Environment

Verified on the local machine:

- WSL2 Ubuntu 24.04
- `torch 2.8.0+rocm7.2.0`
- GPU: AMD Radeon RX 7900 XTX
- Python venv: `~/gsv/bin/python`

Key point: ROCm inside WSL may report `hsa_init failed` by default; you need:

    export HSA_ENABLE_DXG_DETECTION=1

Otherwise `rocminfo` and `torch.cuda.is_available()` fail.

## 1. Collect data

    cd /mnt/d/stuff/DSH/001/黑暗森林
    node ai/train/collect.mjs --games=100 --players=2,4,8

Default output:

    ai/train/data/decisions.jsonl
    ai/train/data/summary.json

Baseline collection this round:

- 300 games (100 each for 2/4/8 players)
- 18,254 AI decisions
- label distribution:
  - hide 9,076
  - observe 5,794
  - attack 2,334
  - slip 1,050

Each record contains only that AI's own view:

- its own position/terrain;
- the number of players alive;
- the bombardment targets;
- its own recent known red dots;
- the left/right gunshot counts;
- legal actions;
- the action actually chosen.

It does not contain other players' `position`.

## 2. GPU training

    export HSA_ENABLE_DXG_DETECTION=1
    ~/gsv/bin/python ai/train/train_policy.py --epochs=15

Result of this run:

    torch=2.8.0+rocm7.2.0.gitbf943426 device=cuda
    gpu=AMD Radeon RX 7900 XTX count=1
    rows=18254 train=14573 val=3681 games=300
    epoch 09 loss=0.6736 val_loss=0.7271 val_acc=0.667
    saved ai/train/checkpoints/policy.pt

- Best validation action-type accuracy: **66.7%**
- Majority-class baseline (always guess hide): about 49.7%
- Model: an MLP of 87 → 128 → 128 → 4
- Input: fixed features such as position/terrain/bombardment/known red dots/gunshots/legal actions
- Output: `hide / observe / attack / slip`

This is not a “trained, therefore it wins” model; it only proves:

- the data pipeline runs;
- the GPU really computes;
- the PyTorch/ROCm environment works;
- there is a checkpoint that can keep iterating.

## 2.1 Iteration 1: more data + 3 random seeds

Collection:

    node ai/train/collect.mjs --games=500 --players=2,4,8 --out=ai/train/data/decisions-v2.jsonl

This round:

- 1,500 games
- **92,521 decisions**
- labels: hide 46,456 / observe 29,458 / attack 11,632 / slip 4,975
- class weighting + label smoothing + 256×256 MLP + early stop
- 3 seeds: 7 / 17 / 27

Results:

- seed: 7; best epoch: 10; val acc: 67.0%; macro F1: 0.645
- seed: 17; best epoch: 11; val acc: 66.7%; macro F1: 0.655
- seed: 27; best epoch: 10; val acc: 67.6%; macro F1: 0.643

Conclusions:

- Data grew from 18k to 92k, yet validation accuracy only went from 66.7% to 67.6%;
- **behavior cloning is already close to the ceiling of this feature set**;
- it is not a lack of GPU or of training epochs; more epochs only overfit;
- the next step is to predict action parameters (observation arc length/direction, attack long/short arc, move distance) and to do self-play/RL, rather than further enlarging the action-type classifier.

Artifacts:

    ai/train/iteration-1/collect.log
    ai/train/iteration-1/train-seeds.log
    ai/train/checkpoints/policy-v2-seed7.pt
    ai/train/checkpoints/policy-v2-seed17.pt
    ai/train/checkpoints/policy-v2-seed27.pt

## 3. Artifacts

    ai/train/checkpoints/policy.pt
    ai/train/checkpoints/policy.metrics.json

## Next steps

1. Bring action parameters into training as well (observation arc length/direction, attack target/direction, move direction);
2. Replace pure behavior cloning with self-play + reinforcement learning/self-play evaluation;
3. Export ONNX or hook up a Python inference service, then wire it into the game as an optional model in `ai/models/`;
4. Run larger-scale match evaluation on the GPU instead of only doing action classification.

## Notes

- `ai/train/data/` and `ai/train/checkpoints/` are training artifacts, not files required to run the game.
- The training scripts do not change the game rules, and do not let the AI see other players' positions.
- Ollama's `gpu` model is **inference**, not training; the PyTorch training here is a separate track.
