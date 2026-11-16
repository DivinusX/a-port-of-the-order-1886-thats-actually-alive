"""Shader-cache seeds (issue #17): import guards, export round trip, migration.

Temporary directories and a stubbed `order1886` module only; no game files.
"""
import contextlib
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

_STUB = types.ModuleType('order1886')
_STUB.SHADER_CACHE_ABI = 'native-ps4-v1'
_STUB.editions = types.SimpleNamespace(TITLE_IDS=['CUSA00035'])
sys.modules.setdefault('order1886', _STUB)

import order1886_cache as cache


def _seed_bundle(root, title='CUSA00035', abi='native-ps4-v1', files=None):
    bundle = root / 'shader-cache' / title
    blobs = bundle / 'blobs'
    blobs.mkdir(parents=True)
    manifest = {'title_id': title, 'shader_cache_abi': abi, 'files': {}}
    for name, data in (files or {'g_0x1.key': b'key', '0x2_0.spv': b'spv'}).items():
        (blobs / name).write_bytes(data)
        import hashlib
        manifest['files'][name] = hashlib.sha256(data).digest().hex()
    (bundle / 'bundle.json').write_text(json.dumps(manifest), encoding='utf-8')
    return bundle


class CacheHomeTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.state = Path(temp.name) / 'user' / 'order1886'
        self.state.mkdir(parents=True)

    def test_ensure_creates_gpu_home(self):
        home = cache.ensure_cache_home(self.state)
        self.assertTrue((home / 'cache').is_dir())
        self.assertEqual(home.name, 'native-ps4-v1')

    def test_migrate_adopts_shared_cache_but_never_overwrites(self):
        xdg = self.state.parent / 'xdg'
        shared = xdg / 'shadPS4' / 'cache' / 'CUSA00035'
        shared.mkdir(parents=True)
        (shared / 'profile.bin').write_bytes(b'device')
        (shared / 'g_0x1.key').write_bytes(b'key')
        with _xdg(xdg):
            self.assertEqual(cache.migrate_shared_caches(self.state, lambda *_: None), 2)
        moved = cache.title_cache_dir(self.state, 'CUSA00035')
        self.assertEqual((moved / 'g_0x1.key').read_bytes(), b'key')
        (moved / 'extra.key').write_bytes(b'new')
        with _xdg(xdg):  # the package cache is in use now: the shared copy stays put
            cache.migrate_shared_caches(self.state, lambda *_: None)
        self.assertEqual((moved / 'extra.key').read_bytes(), b'new')


class SeedImportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.install = Path(temp.name)
        self.state = self.install / 'user' / 'order1886'
        self.state.mkdir(parents=True)

    def test_round_trip_then_never_touches_an_active_cache(self):
        _seed_bundle(self.install)
        receipts = cache.import_shader_cache_seeds(self.state, log=lambda *_: None)
        target = cache.title_cache_dir(self.state, 'CUSA00035')
        self.assertEqual(receipts[0]['imported'], 2)
        self.assertEqual((target / 'g_0x1.key').read_bytes(), b'key')
        (target / 'profile.bin').write_bytes(b'device')  # a real session ran
        receipts = cache.import_shader_cache_seeds(self.state, log=lambda *_: None)
        self.assertEqual(receipts[0]['skipped'], 'cache already in use')

    def test_tampered_blob_refuses_the_whole_bundle(self):
        bundle = _seed_bundle(self.install)
        (bundle / 'blobs' / 'g_0x1.key').write_bytes(b'tampered')
        receipts = cache.import_shader_cache_seeds(self.state, log=lambda *_: None)
        self.assertIn('failed verification', receipts[0]['skipped'])
        self.assertFalse(cache.title_cache_dir(self.state, 'CUSA00035').exists())

    def test_abi_mismatch_is_refused(self):
        _seed_bundle(self.install, abi='native-ps4-v0')
        receipts = cache.import_shader_cache_seeds(self.state, log=lambda *_: None)
        self.assertIn('native-ps4-v0', receipts[0]['skipped'])

    def test_export_then_import(self):
        source = cache.title_cache_dir(self.state, 'CUSA00035')
        source.mkdir(parents=True)
        (source / 'g_0x1.key').write_bytes(b'key')
        (source / '0x2_0.spv').write_bytes(b'spv')
        (source / 'profile.bin').write_bytes(b'device')  # ships: replay gate for the device
        (source / '0000000000000001_legacy.bin').write_bytes(b'driver')  # stays behind
        out = self.install / 'bundle'
        cache.export_shader_cache_seed(source, out, 'CUSA00035', log=lambda *_: None)
        self.assertTrue((out / 'blobs' / 'profile.bin').exists())
        self.assertFalse((out / 'blobs' / '0000000000000001_legacy.bin').exists())
        (source / 'g_0x1.key').write_bytes(b'changed after export')
        (self.install / 'shader-cache').mkdir()
        out.rename(self.install / 'shader-cache' / 'CUSA00035')
        fresh = self.install / 'pkg2' / 'user' / 'order1886'
        fresh.mkdir(parents=True)
        receipts = cache.import_shader_cache_seeds(fresh, self.install, log=lambda *_: None)
        self.assertEqual(receipts[0]['imported'], 3)  # keys, spv, profile
        self.assertEqual(
            (cache.title_cache_dir(fresh, 'CUSA00035') / 'g_0x1.key').read_bytes(), b'key')

    def test_prepare_survives_a_broken_seed(self):
        bundle = _seed_bundle(self.install)
        (bundle / 'bundle.json').write_text('{not json', encoding='utf-8')
        self.assertEqual(cache.prepare_cache_for_launch(self.state, log=lambda *_: None), [])


@contextlib.contextmanager
def _xdg(path):
    old = os.environ.get('XDG_DATA_HOME')
    os.environ['XDG_DATA_HOME'] = str(path)
    try:
        yield
    finally:
        if old is None:
            os.environ.pop('XDG_DATA_HOME', None)
        else:
            os.environ['XDG_DATA_HOME'] = old


if __name__ == '__main__':
    unittest.main()
