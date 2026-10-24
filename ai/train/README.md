# AI 训练（WSL2 + ROCm + PyTorch）

> [English](./README.en.md) | 中文

这是 AI 2.0 的**训练起点**，不是最终策略。

当前流程：

1. 用 AI 2.0 自博弈采集决策数据；
2. 在 WSL2 里用 ROCm PyTorch 训练一个小型行为克隆网络；
3. 验证 7900 XTX 真的参与训练；
4. 记录基线，下一步再做自博弈/强化学习或把网络接回游戏。

## 环境

本机已验证：

- WSL2 Ubuntu 24.04
- `torch 2.8.0+rocm7.2.0`
- GPU：AMD Radeon RX 7900 XTX
- Python venv：`~/gsv/bin/python`

关键：WSL 里 ROCm 默认可能报 `hsa_init failed`，需要：

    export HSA_ENABLE_DXG_DETECTION=1

否则 `rocminfo` 和 `torch.cuda.is_available()` 会失败。

## 1. 采集数据

    cd /mnt/d/stuff/DSH/001/黑暗森林
    node ai/train/collect.mjs --games=100 --players=2,4,8

默认输出：

    ai/train/data/decisions.jsonl
    ai/train/data/summary.json

本次基线采集：

- 300 局（2/4/8 人各 100）
- 18,254 条 AI 决策
- 标签分布：
  - hide 9,076
  - observe 5,794
  - attack 2,334
  - slip 1,050

每条记录只包含该 AI 自己的视野：

- 自己的位置/地形；
- 存活人数；
- 轰炸目标；
- 自己的近期已知红点；
- 左右枪声计数；
- 合法动作；
- 实际选择的动作。

不包含其他玩家的 `position`。

## 2. GPU 训练

    export HSA_ENABLE_DXG_DETECTION=1
    ~/gsv/bin/python ai/train/train_policy.py --epochs=15

本次运行结果：

    torch=2.8.0+rocm7.2.0.gitbf943426 device=cuda
    gpu=AMD Radeon RX 7900 XTX count=1
    rows=18254 train=14573 val=3681 games=300
    epoch 09 loss=0.6736 val_loss=0.7271 val_acc=0.667
    saved ai/train/checkpoints/policy.pt

- 最佳验证集动作类型准确率：**66.7%**
- 多数类基线（全猜 hide）：约 49.7%
- 模型：87 → 128 → 128 → 4 的 MLP
- 输入：位置/地形/轰炸/已知红点/枪声/合法动作等固定特征
- 输出：`hide / observe / attack / slip`

这不是“训练完就能打赢”的模型，只是证明：

- 数据管线能跑；
- GPU 真的在算；
- PyTorch/ROCm 环境可用；
- 有一个可继续迭代的 checkpoint。

## 2.1 迭代 1：更多数据 + 3 个随机种子

采集：

    node ai/train/collect.mjs --games=500 --players=2,4,8 --out=ai/train/data/decisions-v2.jsonl

本次：

- 1,500 局
- **92,521 条决策**
- 标签：hide 46,456 / observe 29,458 / attack 11,632 / slip 4,975
- 类别加权 + label smoothing + 256×256 MLP + early stop
- 3 个 seed：7 / 17 / 27

结果：

- seed：7；best epoch：10；val acc：67.0%；macro F1：0.645
- seed：17；best epoch：11；val acc：66.7%；macro F1：0.655
- seed：27；best epoch：10；val acc：67.6%；macro F1：0.643

结论：

- 数据从 18k 增到 92k，验证准确率只从 66.7% 到 67.6%；
- **行为克隆已经接近这套特征的上限**；
- 不是 GPU 不够，也不是训练轮次不够；继续堆 epoch 只会过拟合；
- 下一步要预测动作参数（观测弧长/方向、攻击长/短弧、移动距离），并做自博弈/RL，而不是继续加大动作类型分类器。

产物：

    ai/train/iteration-1/collect.log
    ai/train/iteration-1/train-seeds.log
    ai/train/checkpoints/policy-v2-seed7.pt
    ai/train/checkpoints/policy-v2-seed17.pt
    ai/train/checkpoints/policy-v2-seed27.pt

## 3. 产物

    ai/train/checkpoints/policy.pt
    ai/train/checkpoints/policy.metrics.json

## 下一步

1. 把动作参数也纳入训练（观测弧长/方向、攻击目标/方向、移动方向）；
2. 用自博弈 + 强化学习/自我对弈评估替代纯行为克隆；
3. 导出 ONNX 或接 Python 推理服务，再作为 `ai/models/` 的可选模型接入游戏；
4. 用 GPU 跑更大规模的对局评估，而不是只做动作分类。

## 注意

- `ai/train/data/` 与 `ai/train/checkpoints/` 是训练产物，不是游戏运行必需文件。
- 训练脚本不会修改游戏规则，也不会让 AI 看到其他玩家位置。
- Ollama 的 `gpu` 模型是**推理**，不是训练；这里的 PyTorch 训练是另一条线。
