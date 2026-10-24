# External AI Models · Creation and Import Guide

> English | [中文](./EXTERNAL-MODELS.md)

This document is written for two kinds of people:

1. **Players**: who want to give the host their own AI opponent;
2. **Other large models**: that want to generate a playable AI tendency in this format.

External models **only support JSON condition models**, not arbitrary JavaScript.  
That way the server does not need to execute code of unknown origin, and models are also easier for an LLM to generate and validate.

## 1. Install location

On the **host's** computer, put the model package into:

    ai/external/{model-folder}/model.json

For example:

    ai/external/my-ai/model.json

- Create `ai/external` yourself if it does not exist;
- The directory name is free-form, but English letters, digits, `-` and `_` are recommended;
- Directories starting with `_` are ignored; `ai/external/_template` is the template;
- After adding it, **restart the game server** (double-click `start.bat` again);
- LAN client machines cannot upload models and can only use the models the host already has;
- External models are **not in the random pool** by default and can only be picked manually in the room.

## 2. Minimal working file

    {
      "id": "my-ai",
      "name": "My AI",
      "version": "1.0.0",
      "description": "A more aggressive model",
      "style": {
        "aggression": 0.7,
        "observation": 0.4,
        "hide": 0.4,
        "trapCommit": 0.9,
        "blindFire": 0.3,
        "longArc": 0.7,
        "compartmentClear": 0.5,
        "bombCaution": 0.8
      },
      "rules": []
    }

`id` may only contain:

    A-Z a-z 0-9 _ -

Length 1–40.

## 3. Style weights

All values are `0..1`.

- Field: `aggression`; meaning: tendency to attack proactively when a target is seen
- Field: `observation`; meaning: tendency to observe/search proactively
- Field: `hide`; meaning: tendency to hide on a pillar
- Field: `trapCommit`; meaning: tendency to still attack instead of poking when there is no retreat
- Field: `blindFire`; meaning: tendency to blind-fire by elimination
- Field: `longArc`; meaning: tendency to pick the long arc in pillar-to-pillar duels (≥0.5 favors long)
- Field: `compartmentClear`; meaning: tendency to check the same compartment mid-game / switch zones in the endgame
- Field: `bombCaution`; meaning: tendency to avoid the current bombardment target

Notes:

- When 1v1 locks onto the last player and the opponent has no room to move, the **general rule forces an attack**, unaffected by these weights;
- So `trapCommit` only affects other no-retreat situations; it cannot turn the “locked kill” into a poke.

## 4. Rules array

`rules` are matched from top to bottom; **the first rule that matches takes effect, and the following ones are ignored**.

    {
      "rules": [
        {
          "when": {
            "phase": 2,
            "myComponentSize": { "lte": 4 },
            "nearUnclearedCount": { "gte": 1 }
          },
          "style": {
            "compartmentClear": 0.9,
            "hide": 0.2
          },
          "note": "clear points first in a small compartment during phase 2"
        },
        {
          "when": {
            "phase": 3,
            "alive": { "lte": 3 }
          },
          "style": {
            "aggression": 0.85,
            "blindFire": 0.6,
            "hide": 0.2
          }
        }
      ]
    }

`note` is only for humans to read and is ignored.

Rules **do not need to be mutually exclusive**, and they **do not need to cover every case**:

- Matching stops at the first hit;
- If nothing matches, the default `style` is used;
- Later rules do not stack.

## 5. Condition format

### 5.1 Direct equality

    "phase": 2

Numbers, strings and booleans are supported.

### 5.2 Comparison

    "alive": { "lte": 3 }

Supported:

    gte, lte, gt, lt, eq, neq, in

For example:

    "myComponentSize": { "gte": 2, "lte": 5 }

### 5.3 Arrays

    "bombMode": { "in": ["fast", "double"] }

### 5.4 Combinations

`all`: every condition holds:

    "when": {
      "all": [
        { "phase": 3 },
        { "myExitCount": { "lte": 2 } }
      ]
    }

`any`: any condition holds:

    "when": {
      "any": [
        { "deathsBySlip": { "gte": 2 } },
        { "nearUnclearedCount": { "gte": 2 } }
      ]
    }

`all` / `any` can be nested.

## 6. Available conditions

### Phase and bombardment

    phase                  1 / 2 / 3
    bombMode               normal / fast / double
    round
    alive
    initialPlayers
    aliveRatio
    ruinsCount
    ruinsRatio
    bombTargetCount
    bombTargetOnMe
    bombTargetInMyCompartment
    bombTargetDistance
    futureBlockedCount

### Map fragmentation

    componentCount
    largestComponentSize
    largestComponentShare
    myComponentSize
    myComponentShare
    myExitCount
    myChokePoint
    nearUnclearedCount
    unclearedCompartmentCount
    compartmentRisk

### Player count and density

    playerDensity
    myCompartmentPressure

### Known information

    knownTargetCount
    knownTargetAge
    knownTargetDistance
    knownTargetOnPillar
    lastObserveRound
    roundsSinceLastObserve
    candidateCount
    candidateConcentration
    blindConfidence
    lockedLastEnemy
    targetHasNoMoves

### Own state

    myTerrain
    canHideEffective
    legalMoveCount
    bombOnMe
    samePositionRounds
    roundsSinceLastAttack
    roundsSinceLastMove
    lastAction

### Death and combat history

    deathsByGun
    deathsBySlip
    deathsByBomb
    deathsLast3Rounds
    slipDeathsThisGame
    gunDeathsThisGame

These come only from public death causes and do not include the killer's identity.

### Notes

- `phase` comes from the current bombardment mode: normal = 1, fast = 2, double = 3;
- `componentCount` and the like are computed from “current ruins + next-round bombardment targets”;
- `lockedLastEnemy` is the general 1v1 lock condition;
- `targetHasNoMoves` means the segment of the last known enemy has no room to move at all;
- No condition reads other players' real coordinates.

## 7. Complexity limits

- Item: `model.json` file; limit: 128 KB
- Item: number of rules; limit: 256
- Item: conditions per rule; limit: 32
- Item: total conditions; limit: 2048
- Item: estimated memory; limit: 1 MB

If any limit is exceeded:

- The model still appears in the list;
- The description shows **Model overflow** (模型溢出);
- It cannot be selected or used in a match.

Format errors:

- The file name/model name is shown;
- The description shows **Model unreadable** (模型无法读取);
- It cannot be selected.

## 8. Validation

The host can run:

    npm run ai:validate -- ai/external/my-ai/model.json

Or:

    node tools/validate-ai-model.mjs ai/external/my-ai/model.json

Success:

    {
      "ok": true,
      "id": "my-ai",
      "rules": 2,
      "conditions": 5
    }

A failure reports `invalid` or `overflow` plus the reason.

## 9. Prompt for having a large model generate a model

You can hand the block below to another model as is:

    You are to generate an external AI model for a hidden-information, simultaneous-action ring board game.
    Output JSON only, no explanation.

    Format:
    {
      "id": "...",
      "name": "...",
      "version": "1.0.0",
      "description": "...",
      "style": {
        "aggression": 0..1,
        "observation": 0..1,
        "hide": 0..1,
        "trapCommit": 0..1,
        "blindFire": 0..1,
        "longArc": 0..1,
        "compartmentClear": 0..1,
        "bombCaution": 0..1
      },
      "rules": [
        {
          "when": { conditions },
          "style": { weight overrides }
        }
      ]
    }

    Hard limits:
    - id may only contain A-Z a-z 0-9 _ -, 1..40 characters;
    - at most 256 rules;
    - at most 32 conditions per rule;
    - all style values 0..1;
    - the first matching rule from top to bottom takes effect;
    - no JavaScript, JSON only;
    - do not read other players' real positions;
    - when 1v1 locks onto the last player and the opponent has no room to move, the general rule forces an attack, so there is no need to repeat it in the rules.

    See ai/EXTERNAL-MODELS.en.md for the available conditions.

## 10. Design suggestions

### Aggressive

    "style": {
      "aggression": 0.8,
      "hide": 0.25,
      "trapCommit": 1.0,
      "blindFire": 0.5,
      "longArc": 0.85,
      "compartmentClear": 0.6,
      "bombCaution": 0.5
    }

### Conservative

    "style": {
      "aggression": 0.35,
      "observation": 0.7,
      "hide": 0.75,
      "trapCommit": 0.7,
      "blindFire": 0.2,
      "longArc": 0.5,
      "compartmentClear": 0.7,
      "bombCaution": 0.9
    }

### Mid-game point clearing

    "rules": [
      {
        "when": {
          "phase": { "in": [2, 3] },
          "myComponentSize": { "lte": 5 },
          "nearUnclearedCount": { "gte": 1 }
        },
        "style": {
          "compartmentClear": 1.0,
          "hide": 0.15,
          "observation": 0.7
        }
      }
    ]

## 11. Limitations

- Only JSON condition models are supported;
- No network requests, file reads or arbitrary code;
- Over the LAN, only the host can provide models;
- External models are not in the random pool;
- Model packages are not synced to client machines; clients only receive the host's model list;
- After changing `model.json`, the server must be restarted to re-read it.
