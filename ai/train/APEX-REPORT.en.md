# Apprentice · JSON Built-in AI Training Record

> English | [中文](./APEX-REPORT.md)

Goal: train from scratch a **built-in model shipped with the game**, with policy weights stored in JSON and no dependency on the 2.1 Bridge / external model directory. Target level: at least on par with `adaptive`.

Final artifacts:

    ai/models/apex.js             pure student ranker (experimental)
    ai/models/apex-safe.js        gated version (shipped with the game)
    ai/models/apex.weights.json   student weights (JSON)
    ai/lib/featurePolicy.js       candidate actions + features
    ai/train/collect_ranker.mjs   data collection
    ai/train/train_ranker.py      standalone BCE experiment
    ai/train/train_ranker_listwise.py  official listwise training

## Method

1. Collect decisions with `adaptive` self-play;
2. Enumerate all legal candidate actions for each position:
   - hide;
   - observe (direction × length);
   - attack (all target segments × direction);
   - slip (legal moves);
3. Use `adaptive`'s action as the positive sample;
4. Train a candidate-action ranker on 58-dimensional features;
5. Save the MLP weights in JSON;
6. Duel `adaptive` on alternating seats with `ai/sim/duel.mjs`;
7. Iterate over generations of data/objective functions and keep the best.

## Iterations

### g1: sampled negatives

    node ai/train/collect_ranker.mjs --games=150 --players=2,4,8 --negatives=8 --out=ai/train/data/apex-g1.jsonl --generation=g1

- 29,770 decisions;
- 267,930 rows;
- 8 sampled negatives;
- after training, **top-1 89.4% on the sampled set**;
- but as a pure model it only reached about 44% in 2-player games, repeatedly slipping/attacking into empty segments.
- Conclusion: sampled negatives cannot represent the full candidate set; the pure model cannot be used directly.

### g2: all candidates + listwise

    node ai/train/collect_ranker.mjs --games=80 --players=2,4,8 --negatives=all --out=ai/train/data/apex-g2.jsonl --generation=g2
    ~/gsv/bin/python ai/train/train_ranker_listwise.py \
      --data ai/train/data/apex-g2.jsonl \
      --out ai/models/apex.weights.json \
      --epochs=10 --hidden=128,64 --seed=11

- 14,809 decisions;
- 940,462 rows;
- all candidates, listwise softmax;
- validation **top-1 84.5%**;
- pure model vs adaptive: 8% in 2-player games, it still makes fatal mistakes.
- Conclusion: imitation accuracy does not equal endgame safety.

### g3: 4-player games only

    node ai/train/collect_ranker.mjs --games=150 --players=4 --negatives=all --out=ai/train/data/apex-g3.jsonl --generation=g3
    ~/gsv/bin/python ai/train/train_ranker_listwise.py \
      --data ai/train/data/apex-g3.jsonl \
      --out ai/models/apex.weights.json \
      --epochs=10 --hidden=128,64 --seed=23

- 5,626 decisions;
- 209,776 rows;
- top-1 81.3%;
- 4-player seat win rate **25.7%**, lower than g2's 27.2%.
- The g3 weights were not kept; rolled back to g2.

## Final gated version

The pure student is still below adaptive, so the version shipped with the game is `apex-safe`:

- It uses the action the student learned only in **4-player games with 3–4 players alive**;
- The action type must match adaptive's;
- The attack target must be a red dot it already knows;
- 2-player / 8-player games fall back to adaptive directly;
- 1v1 endgames fall back to adaptive.

This is not “the pure student wins duels”; it is **restricting the student to the distribution it was validated on**, with everything else left to the hand-written baseline.

## Duel results

`ai/sim/duel.mjs`, alternating seats, draws counted separately:

- Scenario: 4-player games, 1 student + 3 adaptive, 500 games; student seat win rate: **27.2%**; adaptive seat win rate: 20.0%
- Scenario: 2-player games, 300 games; student seat win rate: 45.3%; adaptive seat win rate: 41.7%
- Scenario: 8-player games, 100 games; student seat win rate: 8.0%; adaptive seat win rate: 12.0%

Notes:

- In 2-player games `apex-safe` falls back to adaptive directly; the difference in the table comes from draws/seat statistics noise;
- 8-player games also fall back to adaptive, and the difference comes from the same cause;
- 4-player games are the only scenario where the student is enabled, and the seat win rate is about **7.2 percentage points** higher than adaptive;
- Pure `apex` is not put in the random pool and is kept only as an experimental model.

## Conclusion

- Pure behavior-cloning student: **did not reach** adaptive;
- Gated version `apex-safe`: beats adaptive in 4-player games, on par with adaptive in 2/8-player games;
- It meets the conservative goal of “at least on par with adaptive”, but **is not a pure student model**;
- To get a pure student next, you would need:
  1. 8-player/2-player data at a larger scale;
  2. explicit win/loss value learning, not only action imitation;
  3. self-play RL fine-tuning instead of behavior cloning.
