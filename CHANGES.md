# Changes Made - November 6, 2026

## v0.2.7-hotfix.1 — November 6, 2026

### Fixed: Mixed-case game dumps (CUSA00035 and others)

**Problem:** Button prompts (Xbox/Keyboard) failed to build on game dumps where the update
extraction left `_data/1408209885/PS4/` (uppercase) beside the base game's `ps4/` (lowercase).
The launcher looked for UI resources at the exact lowercase path and refused the dump with:
`Button prompts are verified with CUSA00076 1.02; this game has no primary/c2d79afbc68fc86c/v1/...`

**Fix:** The launcher now tolerates mixed-case directory names when resolving UI resources.
`ui.resolve()` walks each path component, tries exact case first, then falls back to
case-insensitive match — matching what `runtime_file.c fold_case()` does for guest paths at
runtime. Mod overlays also tolerate mixed-case original game folders while keeping the strict
rule for mod folders (so two mods cannot fight by case alone).

**Files changed:**
- `scripts/order1886_ui_extract.py` — added `resolve()` function for case-tolerant lookup
- `scripts/order1886_prompts.py` — uses `resolve()` to find resources
- `scripts/order1886_glyph_mod.py` — uses `resolve()` when building prompts
- `scripts/order1886_mods.py` — tolerates mixed-case original game folders
- `tests/test_order1886_mixed_case.py` — new test coverage

**Affected editions:** CUSA00035, CUSA00070, CUSA00100, CUSA00670, CUSA00785 (experimental
editions where update extraction can leave mixed-case directories).

**Workaround for older builds:** Switch Button prompts to "PlayStation" in the launcher's
Controls page — those use DualShock 4 glyphs that ship with every edition.


## Windows Compatibility Added

### What was done
- Downloaded official Windows package (v0.2.7) from upstream GitHub releases
- Added Windows executables: `The Order 1886.exe` and `Play The Order 1886.exe`
- Added `bin-windows/` directory with 100+ Windows DLLs (runtime, launcher, dependencies)
- Created `WINDOWS-README.txt` with Windows-specific setup instructions

### Files added
- `The Order 1886.exe` (13MB) - Windows launcher with GUI
- `Play The Order 1886.exe` (13MB) - Windows direct play executable
- `bin-windows/` - Windows runtime, launcher and 100+ DLLs (393MB)
- `WINDOWS-README.txt` - Windows setup guide

### Repository setup
- Created GitHub repository: `a-port-of-the-order-1886-thats-actually-alive`
- Configured `.gitignore` to exclude large binaries and user data
- Packaged binaries as release assets:
  - `order1886-linux-x86_64.tar.gz` (227MB) - Linux build
  - `order1886-go-windows.zip` (128MB) - Windows build

### Compatibility notes
- Both Linux and Windows versions now coexist in the same folder
- `user/` folder (settings, saves, logs) is shared between platforms
- Original game files are never modified
- No Python or additional software required on either platform

### Requirements
**Windows:**
- Windows 10/11 x86-64
- Vulkan-compatible GPU with up-to-date drivers

**Linux:**
- x86-64 Linux with glibc 2.39+
- Vulkan GPU driver
- WebKitGTK 4.1 (optional, for launcher GUI)

### Supported game versions
All six editions accepted: CUSA00076 (tested), CUSA00035, CUSA00070, CUSA00100, CUSA00670, CUSA00785 (experimental)

### Credits
Based on the upstream project by JulioCacko: https://github.com/JulioCacko/The-Order-1886_pc
