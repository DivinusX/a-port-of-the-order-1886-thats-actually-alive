# Windows port — approval runbook (v0.2.18)

Everything below is the complete path from "approved" to a published Windows release.
Commands are copy-pasteable; each step says what to check before going on. Nothing here
has been executed — the push is the gate the person owns.

## 0. Review (no side effects)

```bash
cd /tmp/aport && git log --oneline main..windows-port          # 5 commits: plan, packaging, docs
cd /tmp/order1886-src && git log --oneline origin/main..windows-port   # 5 commits: 3 feature + 2 port
```

Read `docs/verification/2026-11-08-windows-port-plan.md` (§0 ground truth, §2–3 file tables,
§6 flagged gaps, §8 what was actually compiled here).

## 1. Push the release repo branch

```bash
cd /tmp/aport
git push -u origin windows-port
```

Check on GitHub: branch `windows-port` exists; nothing else changed (main untouched).

## 2. Fork the source repo and push its branch (one-time)

The C++/workflow changes live in the clone of `JulioCacko/The-Order-1886_pc`; there is no
DivinusX fork of it yet.

```bash
gh repo fork JulioCacko/The-Order-1886_pc --clone=false
git -C /tmp/order1886-src remote add divinusx \
  https://github.com/DivinusX/The-Order-1886_pc
git -C /tmp/order1886-src push -u divinusx windows-port
```

Check: Actions tab of the new fork shows the existing workflows (they copy with the fork).

## 3. Build the Windows package in CI

```bash
gh workflow run order1886-go-package.yml --repo DivinusX/The-Order-1886_pc \
  --ref windows-port -f package_version=v0.2.18
watch gh run list --repo DivinusX/The-Order-1886_pc --workflow order1886-go-package.yml -L 1
```

First real compile of: the fsr4 provider on Windows, `pad_diag_windows.c` (linked against
`setupapi`), the vendored launcher overlay, the PyInstaller worker, the PS1 zip step.
Artifacts on success: `order1886-win-zip` (zip + `.sha256`), `order1886-go-package`
(raw tree), `order1886-go-package-evidence` (build logs).

If it fails: the evidence logs name the exact step — report, do not patch blind.

## 4. Finalize the release zip (release-repo side, runs on Linux)

```bash
cd /tmp/aport
gh run download --repo DivinusX/The-Order-1886_pc <RUN_ID> -n order1886-go-package -D /tmp/ci-tree
mkdir -p extra/docs/verification
cp WINDOWS.md CHANGES.md README.md extra/
cp docs/verification/2026-11-08-windows-port-checklist.md extra/docs/verification/
python3 packaging/windows/order1886-win-package.py \
  --tree "/tmp/ci-tree/The Order 1886" --version v0.2.18 --extra extra --out dist/
```

Checks printed: every manifest hash verified, no `.so`/`.sh`/`user/`, docs merged and
re-hashed, `order1886-win-x86_64-v0.2.18.zip` + `.sha256` written.
Optionally stage `music/` into the tree first only if the OST decision is made (plan §6).

## 5. Hardware pass (the checklist is the gate)

Run `docs/verification/2026-11-08-windows-port-checklist.md` on a physical Windows 10/11
box with the legally owned dump. Record GPU/driver/OS build per section. The zip is
**not** released until this passes or failures are triaged.

## 6. Release

```bash
cd /tmp/aport
gh release create v0.2.18 dist/order1886-win-x86_64-v0.2.18.zip \
  dist/order1886-win-x86_64-v0.2.18.zip.sha256 \
  --title "v0.2.18: Windows x86-64 package — same source, same fixes, hardware-passed" \
  --notes-file <changelog section for v0.2.18 + unverified-list updates>
```

The release notes credit the Main Maintainer: **DivinusX** — releases, hardware
verification and funding of this fork (upstream base by JulioCacko).

GPL-2.0-or-later requires the corresponding source to accompany the binaries: the notes
must link `https://github.com/DivinusX/The-Order-1886_pc/tree/windows-port` (source repo
branch from step 2, whose `runtime-build.json` receipt binds the exact revision) plus the
release repo's `windows-port` branch for the packaging and launcher overlay.

Merge `windows-port` into `main` in both repos (or open the PRs), after the release exists.

## Known open items going into step 5 (from the plan, unchanged)

- FSR 4 on Windows: provider + bundle path verified by code review and pattern-copy only;
  first real execution is the hardware checklist (§4 of the checklist).
- Pad-check wording under real XInput/Steam conditions.
- SmartScreen/Defender experience on a clean machine.
- Long sessions, 4K/60, driver-specific behaviour.
- The Linux release flow is untouched throughout; `main` keeps shipping v0.2.17 until the
  merge in step 6.
