# 学徒 · JSON 内置 AI 训练记录

> [English](./APEX-REPORT.en.md) | 中文

目标：从 0 训练一个**随游戏发布的内置模型**，策略权重用 JSON 保存，不依赖 2.1 的 Bridge / 外部模型目录。目标水平：至少比肩 `adaptive`。

最终产物：

    ai/models/apex.js             纯学生排序器（实验）
    ai/models/apex-safe.js        守门版（随游戏使用）
    ai/models/apex.weights.json   学生权重（JSON）
    ai/lib/featurePolicy.js       候选动作 + 特征
    ai/train/collect_ranker.mjs   数据采集
    ai/train/train_ranker.py      独立 BCE 实验
    ai/train/train_ranker_listwise.py  listwise 正式训练

## 方法

1. 用 `adaptive` 自博弈采集决策；
2. 每个局面枚举全部合法候选动作：
   - 藏；
   - 观（方向 × 长度）；
   - 攻（所有目标段 × 方向）；
   - 溜（合法移动）；
3. 以 `adaptive` 的行动为正样本；
4. 用 58 维特征训练候选动作排序器；
5. 在 JSON 中保存 MLP 权重；
6. 用 `ai/sim/duel.mjs` 与 `adaptive` 交替座位对战；
7. 多代数据/目标函数迭代，保留最优。

## 迭代

### g1：采样负样本

    node ai/train/collect_ranker.mjs --games=150 --players=2,4,8 --negatives=8 --out=ai/train/data/apex-g1.jsonl --generation=g1

- 29,770 个决策；
- 267,930 行；
- 采样 8 个负样本；
- 训练后**采样集 top-1 89.4%**；
- 但对战纯模型在 2 人局只有约 44%，会连续溜/攻空。
- 结论：采样负样本不能代表全候选集，纯模型不可直接用。

### g2：全候选 + listwise

    node ai/train/collect_ranker.mjs --games=80 --players=2,4,8 --negatives=all --out=ai/train/data/apex-g2.jsonl --generation=g2
    ~/gsv/bin/python ai/train/train_ranker_listwise.py \
      --data ai/train/data/apex-g2.jsonl \
      --out ai/models/apex.weights.json \
      --epochs=10 --hidden=128,64 --seed=11

- 14,809 个决策；
- 940,462 行；
- 全部候选，listwise softmax；
- 验证集 **top-1 84.5%**；
- 纯模型对 adaptive：2 人局 8%，仍会犯致命错误。
- 结论：模仿准确率不等于残局安全。

### g3：只采 4 人局

    node ai/train/collect_ranker.mjs --games=150 --players=4 --negatives=all --out=ai/train/data/apex-g3.jsonl --generation=g3
    ~/gsv/bin/python ai/train/train_ranker_listwise.py \
      --data ai/train/data/apex-g3.jsonl \
      --out ai/models/apex.weights.json \
      --epochs=10 --hidden=128,64 --seed=23

- 5,626 个决策；
- 209,776 行；
- top-1 81.3%；
- 4 人局座位胜率 **25.7%**，低于 g2 的 27.2%。
- 未保留 g3 权重，回滚 g2。

## 最终守门版

纯学生仍低于 adaptive，因此最终随游戏使用的是 `apex-safe`：

- 只在 **4 人局、存活 3–4 人** 时启用学生学习到的动作；
- 动作类型必须与 adaptive 一致；
- 攻击目标必须是自己已知的红点；
- 2 人 / 8 人局直接回退 adaptive；
- 1v1 残局回退 adaptive。

这不是“纯学生单挑打赢”，而是**把学生限制在它被验证过的分布内**，其余交给手写基线。

## 对战结果

`ai/sim/duel.mjs`，交替座位，平局单列：

- 场景：4 人局，1 学生 + 3 adaptive，500 局；学生座位胜率：**27.2%**；adaptive 座位胜率：20.0%
- 场景：2 人局，300 局；学生座位胜率：45.3%；adaptive 座位胜率：41.7%
- 场景：8 人局，100 局；学生座位胜率：8.0%；adaptive 座位胜率：12.0%

说明：

- 2 人局 `apex-safe` 直接回退 adaptive，表里的差异来自平局/座位统计噪声；
- 8 人局也回退 adaptive，差异来自同一原因；
- 4 人局是唯一启用学生的场景，座位胜率比 adaptive 高约 **7.2 个百分点**；
- 纯 `apex` 不放进随机池，只作为实验模型保留。

## 结论

- 纯行为克隆学生：**没有达到** adaptive；
- 守门版 `apex-safe`：在 4 人局超过 adaptive，在 2/8 人局与 adaptive 同级；
- 满足“至少比肩 adaptive”的保守目标，但**不是纯学生模型**；
- 下一步若要做纯学生，需要：
  1. 更大规模 8 人/2 人数据；
  2. 显式胜负价值学习，而不是只模仿动作；
  3. 用自博弈 RL 微调，而不是行为克隆。
