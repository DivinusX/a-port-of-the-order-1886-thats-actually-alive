# launcher-py overlay: game language selector

Adds **Game & Content → Game language** to the launcher. The game reads one PS4 system language
(`ORDER1886_LANGUAGE`) for both text and voices, so a single selector replaces the two disabled
text/voice placeholders (upstream #21). "Follow launcher language" keeps the old behaviour.
The choice applies on the next launch.

## Why every language used to become English

The executable translates the PS4 system language through a table at `0xf13370` (21 languages),
then filters the result by SKU. It reads the SKU from a `-sku` argument the runtime never
passes, so it runs as **SKU 0**, whose filter (`0xa81687`) keeps only US English, Korean and
Chinese. `scripts/order1886_patches.py` (`LANGUAGE`) adds a recipe that is applied to every
prepared image. It points SKU 0's entry in the SKU jump table (`0xa81b00`, rel32
`87fbffff` → `98fbffff`) at the store SKU 3 already uses (`0xa81698`), so the selected language
reaches the game unfiltered. Original game files are never modified. `order1886_editions.py`
drops its Brazilian Portuguese → Portugal Portuguese substitution, which was based on that same
filter.

## What is here

| file | replaces in the worker | what it does |
|---|---|---|
| `launcher/order1886_options.py` | `launcher.order1886_options` | adds the `game_language` field (21 languages + Follow) right after the game folder, and removes the two disabled placeholders |
| `launcher/order1886_common.py` | `launcher.order1886_common` | `backend_command` passes the chosen language as `--system-language` |
| `repack_worker.py` | — | puts the two modules above, plus `scripts/order1886_patches.py` and `scripts/order1886_editions.py`, into a built worker |

The overlay modules wrap the shipped ones: each imports `launcher._<name>_base` (the original,
renamed by the repack), adds to it, and replaces itself with it in `sys.modules`. Every other
importer therefore sees one module. The frontend already handles a `game_language` field
(`launcher-frontend`, including the Home strip chip), so the launcher binary needs no change
for this.

## Applying it to a package

```sh
python3.15 launcher-py-overlay/repack_worker.py "<package>/bin/order1886-worker/order1886-worker"
```

- Use the **same Python minor version as the worker** (3.15 for the 0.2.x packages). The script
  checks this and refuses otherwise. It needs `objcopy`.
- The original is kept as `order1886-worker.orig`. A second run on the same worker is refused.
- Copy `scripts/order1886_patches.py` and `scripts/order1886_editions.py` into
  `<package>/scripts/` too. The worker runs the archived copies, but the package ships the
  sources next to it.
- Regenerate `package-manifest.json` afterwards.

## Languages and dumps

The selector offers what the executable accepts. Whether a language works depends on the
dump containing its assets.

- On a CUSA00035 (US) dump, **Español (Latinoamérica)** was verified in game: menus and text
  in Spanish, no missing files.
- On that same dump, **Español (España)** stops on a black screen, because one of its
  resources (`…1cf8f1244dcc08d3`) is not in the dump at all. Other languages are untested.
- Dumps with the 1.02 update extracted as `_data/1408209885/PS4/` beside the base `ps4/` keep
  most localized files only in `PS4/`. The runtime's case folding does not merge the two
  trees, so those languages crash on a missing file until the trees are merged with
  `scripts/order1886_merge_update.py --apply`.
- If a language crashes or hangs, the session log's `open(...) -> not found` lines name the
  missing resource.
