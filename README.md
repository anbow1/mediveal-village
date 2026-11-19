# New game AAA — lite

Same goal as `docs/new-game-AAA/`: a new three.js game (WebGPU + TSL, browser
and APK) as close to AAA as the platform allows. Built to save the model's
context: the model reads **one file** (`GUIDE.md`, ~5.5 k tokens) instead of
~20 k tokens of rules and six sheet images up front, and opens the rest only
section by section.

## Three steps

1. Copy this folder into an empty project folder.
2. Fill in `games/new-game/DESCRIPTION.md`; put photos in
   `games/new-game/references/`.
3. Paste `FIRST-MESSAGE.md` as the first message.

## What is here

| File | What for |
|---|---|
| `GUIDE.md` | everything mandatory: working rules, R1–R12, **the quality bar (what gives a picture away, and the fix)**, stages 0–8 with checks, engineering musts, verification and how to measure, report format, top traps, an index of the playbook |
| `NUMBERS.md` | the reference sheets as text (light, PBR, scale, ballistics, HUD, budget) |
| `FIRST-MESSAGE.md` | the first message |
| `games/new-game/` | the description form and reference photos; the model adds `RESULTS.md`, the log of every measurement |
| `tools/`, `shared-src/` | same as the full kit: measurement scripts, Blender scripts, shared source |
| `reference-sheets/` | the PNG sheets, for when a picture is needed |
| `docs/graphics-playbook.md` | the full playbook; read by section only |

Left out on purpose: `AGENT.md`, `START.md`, `rules/`, `NEW-GAME-AAA.md`,
`ROUTINE-WORK.md`, `TEST-RUN.md` (their content is condensed into `GUIDE.md`).
For a test without ready solutions, delete `docs/` and `shared-src/`.

`GUIDE.md`, `NUMBERS.md`, `README.md` and `FIRST-MESSAGE.md` are written by
hand; when the full guide changes, update `GUIDE.md` too. The rest is refreshed
by `bash docs/model-kit/sync.sh`.
