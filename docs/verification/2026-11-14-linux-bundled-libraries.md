# Linux: "libZydis.so.5: cannot open shared object file" — 2026-11-14

Issue: [#5](https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/issues/5)
(Bazzite 45, package 0.2.17, 100% default settings, CUSA00076 and CUSA00035 alike). Tool:
[`packaging/linux/order1886-bundle.py`](../../packaging/linux/order1886-bundle.py).

## The failure

The reporter's boot log:

```
.../bin/order1886-runtime.bin: error while loading shared libraries: libZydis.so.5:
cannot open shared object file: No such file or directory
```

The runtime exits with 127 before the game starts, although `bin/gpu/libZydis.so.5` is in the
package. The game edition and region do not matter.

## Cause: the 0.2.17 package was not self-contained

`bin/order1886-runtime.bin` finds `libps4gpu.so` through its own RUNPATH (`$ORIGIN/gpu`). A
RUNPATH only covers the object's own dependencies, and `libps4gpu.so` had RUNPATH
**`/tmp/ffmstage/usr/lib64`**, a folder on the machine that built the release. So the
dynamic linker never looked in `bin/gpu/` for Zydis, xxhash or SDL3, and asked the system
instead.

That folder name points to the second half of the problem. The build machine compiled its
own FFmpeg there, and the package took **FFmpeg** (`libavcodec.so.63`, `libavformat.so.63`,
`libavutil.so.61`, `libswscale.so.10`, `libswresample.so.7`) and **`libfmt.so.12`** from the
system instead of bundling them. With Zydis fixed alone, a distribution without exactly
those versions fails on `libavformat.so.63` next. It works on a current Arch only because
Arch happens to ship them.

The upstream Linux packager (`packaging/linux/order1886-go-package.py`) does this properly:
it copies the non-system closure into `bin/gpu/` and runs `patchelf --set-rpath '$ORIGIN'`.
The 0.2.17 package did not go through it. Its `bin/gpu/` still held FFmpeg 6's libraries
(`libavcodec.so.60`, an old `libva.so.2`, ...) next to a `libps4gpu.so` built against
FFmpeg 63.

## The tool

`packaging/linux/order1886-bundle.py`:

- **`check <package>`** reads the ELF dynamic sections (nothing is executed). It follows the
  closure from `bin/order1886-runtime.bin` the way the dynamic linker does: each dependency
  is looked up in the RUNPATH of the object that needs it, with `$ORIGIN` expanded. It reports
  every non-system dependency that would come from outside the package, and every RUNPATH that
  points outside it. Exit 1 on any problem; **run it on every Linux package before
  publishing.** The base-system list is upstream's `SYSTEM_LIBRARY`, plus glibc's `libmvec`.
- **`fix <package>`** copies the closure from the build machine into `bin/gpu/` and sets
  RUNPATH `$ORIGIN` on `libps4gpu.so` and on every bundled library, then runs `check`. Where
  the build machine has a library, its copy replaces any stale one in the package. A package
  copy is kept only when the build machine has no such library (Zydis 5 on most
  distributions). It refuses to modify anything outside `bin/gpu/`.

The runtime binary itself is left byte-identical to its build receipt, as upstream does. Its
second RUNPATH entry, `/tmp/order1886-src/out/gpu`, is searched only after `$ORIGIN/gpu` and is
reported as a warning, not an error.

## Verification (Arch, x86-64, patchelf 0.19.3)

`check` on the 0.2.17 package as released (`bin/order1886-runtime.bin` plus `bin/gpu/` with
the original `libps4gpu.so`) reports 13 problems (and one warning) and exits 1. Every one of them is part of
this issue:

- `libps4gpu.so`: RUNPATH `/tmp/ffmstage/usr/lib64` points outside the package.
- `libZydis.so.5`, `libxxhash.so.0` and `libSDL3.so.0` are bundled but not on its RUNPATH.
- `libavformat.so.63`, `libavcodec.so.63`, `libavutil.so.61`, `libswscale.so.10`,
  `libswresample.so.7` and `libfmt.so.12` are not bundled.

`fix` on a copy of that package added or replaced 100 libraries, and `check` then passes.

The first `fix` attempt kept the stale bundled copies. Under the sandbox test below, the new
`libavutil.so.61` then failed with `undefined symbol: vaMapBuffer2` against FFmpeg 6's
`libva.so.2`. That is why `fix` now replaces stale copies. `check` alone cannot see this kind
of problem (it checks where a library comes from, not symbol versions); the sandbox test can.

**Sandbox test.** A `bubblewrap` view of this machine with the host's copy of every library
that `bin/gpu/` holds (120 files) bound to `/dev/null` stands in for a distribution that lacks
them:

| package | `ldd`: not found | `order1886-runtime.bin --runtime-info` |
|---|---|---|
| 0.2.17 as released | 11 | exit 127, `libavcodec.so.63` |
| 0.2.17 after `fix` | 0 (126 resolved in the package or the base system) | exit 0 |

The full game was then started from the fixed `bin/gpu/`, with the launcher's backend and
default settings, in the same sandbox. It reached the main menu at 30.0 FPS (NVIDIA RTX
5050 Laptop, proprietary driver) and shut down cleanly: 2,017 files opened, 0 not found,
no faults.

Not tested: Bazzite or Fedora themselves, and AMD/Intel drivers inside the sandbox. Libraries
copied from a newer distribution require at least that distribution's glibc. Build the
release on the oldest distribution it should support, then run `fix` and `check` there.

## For the next release

```sh
python3 packaging/linux/order1886-bundle.py fix  "<package>/The Order 1886"
python3 packaging/linux/order1886-bundle.py check "<package>/The Order 1886"   # must print OK
```

Then regenerate `package-manifest.json`, since `bin/gpu/` changes.

**Workaround for 0.2.17 users** until then: Zydis only needs `libps4gpu.so` to look in its own
folder (`patchelf --set-rpath '$ORIGIN' bin/gpu/libps4gpu.so`). That is enough only on
distributions that ship FFmpeg 63 (`libavformat.so.63`) and `libfmt.so.12`.
