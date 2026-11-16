# Handoff: stale-duplicate guard fix + repo review — 16 Nov 2026 (omp session)

Audience: the next agent (Claude or otherwise) picking this repo up.
Repo: `~/Documents/PS4/order1886-src` @ local `main`. Nothing in this report was
pushed; origin is still `4d684a2` (v0.2.23).

## Working rules the owner set (2026-11-16)

- Fix **one issue at a time**; the owner chooses which.
- Do **not** push, tag, or create releases without explicit authorization.
  This report and its commit stay local until the owner says otherwise.
- The repo carries a long chain of verified fixes (see `docs/verification/`):
  do not break them. Read the matching verification note before touching an area.
- When finishing something, write a handoff report here (`docs/handoff/`,
  same spirit as `docs/verification/` but focused on state + next steps).

## What was done

### 1. Fix: `_base_is_stale` never fired (local commit `79ae430ec0`)

`scripts/order1886_prompts.py::_base_is_stale` appended `'ps4'`/`'PS4'` to
`ui.NAMESPACE`, but `NAMESPACE = '_data/1408209885/ps4'` already contains the
lowercase `ps4` component (set in `12e922a`, before the function existed in
`a27a7a4` / v0.2.9). It therefore tested `.../ps4/ps4/...` and `.../ps4/PS4/...`
— paths that never exist — and always returned False.

Consequence: the guard in `prepare()` that refuses to paint button-prompt
overlays on a dump whose update was extracted beside the base *without merging*
(order1886_prompts.py:226-231) has been silently dead since v0.2.9. Such dumps
get stale 1.00 prompt art — the scrambled-QTE symptom `6790ebd` tried to fix.
`tests/test_order1886_mixed_case.py::StaleBaseTests` has failed on every
revision since it was introduced, which is how this was found:

    python3 -m unittest discover -s tests   # was 24 + 1 FAIL, now 25 OK

The fix compares the base copy (`game/NAMESPACE/resource`) against the update
sibling (`game/<parent-of-NAMESPACE>/PS4/resource`), matching how
`order1886_ui_extract.resolve()` treats the two trees. Audited all other
`NAMESPACE` callers (`glyph_mod` joins it bare; `merge_update` defines its own
parent-level constant) — only this site was wrong.

Verified: full suite green; live read-only check against
`~/Documents/PS4/CUSA00035/CUSA00035` (a merged, lowercase-only dump) now
returns False for the correct reason (no `PS4` sibling exists) instead of the
broken path.

### 2. Repo review — findings, no changes made

- Engine lives in the sibling checkout `~/Documents/PS4/engine-src`
  (DivinusX/The-Order-1886_pc, branch `windows-port-v0.2.22` = `bdd172d`); the
  release "CI" workflows are in **that** repo. This repo's release flow:
  packages restructured by `~/Documents/PS4/order1886-release-v0.2.23/finalize.py`,
  assets uploaded from an authenticated context that **no longer exists here**
  (`gh` logged out, no credential helper). Re-auth is required before any push.
- The 25 unit tests are wired to **nothing** — no CI, no hook. That is why the
  dead guard shipped across 14 releases. Candidate: a small CI job in the
  engine repo or a pre-push hook (needs owner approval).
- Root `package-manifest.json` is stale: records the 2026-11-14 dirty build
  (`source_revision 3748288`, `source_dirty: true`), not the `bdd172d` CI build
  v0.2.22/23 ship. Decide: refresh per release or delete.
- `launcher-frontend/` commits only the built bundle (`index-DKp5dai2.js`);
  its source is not in this repo ("upstream `frontend/src` is the older sidebar
  UI", launcher-go-overlay/README). For a GPL-2.0 distribution that is a
  source-completeness problem and blocks any future UI change. Needs the
  original bundle source located or the UI rebuilt.
- v0.2.23 Windows is self-declared **not verified on Windows** (same
  `order1886_display.py` as Linux; nobody ran it there).

## Open issues, triaged (owner picks one at a time)

| # | Title | Note |
|---|---|---|
| 15 | Mouse loses focus on Esc/F1 | Likely v0.2.21 regression: F1 in-game menu + capture handling. Small, reproducible locally. |
| 14 | Launcher not updating + file-check failure | Report has launcher log + screenshots; verify against `scripts/` hash-check paths. |
| 18 | "Game crashes sometimes" (Windows) | RTX 5080, `--presentation-filter dlss`, 3840 render width, `--fps-cap 120`; full worker command in the issue. Not reproducible on this AMD box without their logs. |
| 17 | AOT shader pre-compilation request | Engine-repo feature; design conversation first. |

## How to verify current state

    cd ~/Documents/PS4/order1886-src
    git log --oneline -2        # 79ae430ec0 (local fix) on top of 4d684a2 (v0.2.23)
    python3 -m unittest discover -s tests -q   # 25 OK
