"""Mixed-case dumps: enumeration, replacement case and resolve() (fixtures only)."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import order1886_mods as mods
import order1886_ui_extract as ui


def put(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


class ResolveTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.game = Path(temporary.name)
        self.ns = self.game / ui.NAMESPACE

    def test_exact_case_wins(self):
        put(self.ns / 'primary/p1/v1/res', b'exact')
        self.assertEqual(ui.resolve(self.game, 'primary/p1/v1/res').read_bytes(), b'exact')

    def test_folds_a_single_unique_variant(self):
        game = self.game / 'upper'                      # only PS4/ exists
        put(game / '_data/1408209885/PS4/primary/p2/v1/res', b'upper')
        self.assertEqual(ui.resolve(game, 'primary/p2/v1/res').read_bytes(), b'upper')

    def test_ambiguous_siblings_prefer_the_written_case(self):
        put(self.ns / 'primary/p1/v1/res', b'a')
        put(self.game / '_data/1408209885/PS4/primary/p1/v1/res', b'b')
        # An exact lowercase path is what the guest asks for; fold never jumps branches.
        self.assertEqual(ui.resolve(self.game, 'primary/p1/v1/res').read_bytes(), b'a')

    def test_missing_is_none(self):
        put(self.ns / 'primary/p1/v1', b'directory')
        self.assertIsNone(ui.resolve(self.game, 'primary/p1/v1/res'))


class OverlayMixedCaseTests(unittest.TestCase):
    """The mirror may hold ps4/ and PS4/ siblings; a replacement must land on the exact
    case the guest opens, and enumeration must not refuse the dump (case-sensitive FS)."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.game, self.state, self.mods = [self.base / name for name in ('game', 'state', 'mods')]
        self.state.mkdir()
        put(self.game / '_data/1408209885/ps4/primary/p1/v1/res', b'lower original')
        put(self.game / '_data/1408209885/PS4/primary/p2/v1/res', b'upper original')
        put(self.game / '_data/keep', b'untouched')
        put(self.game / 'eboot.bin', b'eboot')
        put(self.game / 'archivemap.bin', b'index')

    def test_mirror_and_replace(self):
        if os.name == 'nt':
            self.skipTest('case-sensitive enumeration only applies to posix dumps')
        put(self.mods / 'Set/_data/1408209885/ps4/primary/p1/v1/res', b'replacement')
        put(self.mods / 'Set/readme.txt', b'ok')
        overlay = mods.build_overlay(self.game, self.state, self.mods, True, ['Set'])
        self.assertNotEqual(overlay, self.game)
        self.assertEqual((overlay / '_data/1408209885/ps4/primary/p1/v1/res').read_bytes(),
                         b'replacement')
        self.assertEqual((overlay / '_data/1408209885/PS4/primary/p2/v1/res').read_bytes(),
                         b'upper original')                       # sibling tree preserved
        self.assertEqual((overlay / '_data/keep').read_bytes(), b'untouched')

    def test_disabling_restores_original_mount(self):
        overlay = mods.build_overlay(self.game, self.state, self.mods, False, [])
        self.assertEqual(overlay, self.game)

    def test_mod_folder_case_conflict_stays_rejected(self):
        put(self.mods / 'Both/_data/1408209885/ps4/primary/p1/v1/res', b'one')
        put(self.mods / 'Both/_data/1408209885/PS4/primary/p1/v1/other', b'two')
        with self.assertRaises(ValueError):
            mods.plan(self.game, self.mods, True, ['Both'])

    def test_exact_case_preferred_over_folded_canonical(self):
        if os.name == 'nt':
            self.skipTest('case-sensitive enumeration only applies to posix dumps')
        # A mod path that matches only the uppercase tree folds to it, not to ps4/.
        put(self.mods / 'Up/_data/1408209885/ps4/primary/p2/v1/res', b'folded')
        replacements, _ = mods.plan(self.game, self.mods, True, ['Up'])
        self.assertEqual([str(rel) for rel, _src in replacements],
                         [str(Path('_data/1408209885/ps4/primary/p2/v1/res'))])


if __name__ == '__main__':
    unittest.main()
