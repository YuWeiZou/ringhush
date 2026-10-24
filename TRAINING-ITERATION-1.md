# AI 训练迭代 1

日期：2026-10-21  
环境：WSL2 Ubuntu 24.04 + ROCm 7.2 + PyTorch 2.8 + RX 7900 XTX  
训练类型：行为克隆（动作类型），**尚未接入游戏对局**

## 数据

    node ai/train/collect.mjs --games=500 --players=2,4,8 --out=ai/train/data/decisions-v2.jsonl

- 1,500 局
- 92,521 条 AI 决策
- 标签：
  - hide 46,456
  - observe 29,458
  - attack 11,632
  - slip 4,975

数据只包含 AI 自己的视野，不包含其他玩家位置。

## 训练

    export HSA_ENABLE_DXG_DETECTION=1
    ~/gsv/bin/python ai/train/train_iter.py \
      --data ai/train/data/decisions-v2.jsonl \
      --epochs 120 --hidden 256 --seed 7

3 个 seed：

- seed：7；best epoch：10；val acc：67.0%；macro F1：0.645
- seed：17；best epoch：11；val acc：66.7%；macro F1：0.655
- seed：27；best epoch：10；val acc：67.6%；macro F1：0.643

## 结论

数据从 18,254 条增加到 92,521 条，验证准确率只从 **66.7%** 到 **67.6%**。

这说明：

- GPU 训练链路正常；
- 继续堆 epoch 已经只会过拟合；
- **当前特征 + 只看动作类型的上限大约就在 67%**；
- 真正要提升，必须让模型预测动作参数并做自博弈，而不是继续加大分类器。

## 产物

    ai/train/iteration-1/collect.log
    ai/train/iteration-1/train-seeds.log
    ai/train/checkpoints/policy-v2-seed7.pt
    ai/train/checkpoints/policy-v2-seed17.pt
    ai/train/checkpoints/policy-v2-seed27.pt
    ai/train/checkpoints/policy-v2-seed*.metrics.json

## 下一步

1. 多任务输出：动作类型 + 观测宽度/方向 + 攻击长/短弧 + 移动距离；
2. 自博弈循环：用当前策略生成新对局，按胜负/存活做强化学习；
3. 导出 ONNX / 独立推理服务，接回 `ai/models/`；
4. 用完整对局胜率而不是动作准确率做评估。

## 当前状态

- 游戏服务：v1.4.1，`http://127.0.0.1:3000`
- Ollama：0.40.6，`qwen2.5:3b`，100% GPU
- 游戏规则/UI 未因训练改变
