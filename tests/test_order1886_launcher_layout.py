"""The launcher's pages: every field has a place, and the window loads the readable UI."""
from pathlib import Path
import re
import unittest

from launcher.order1886_options import FIELDS, PAGES, SECTION_ORDER

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'launcher-go/order1886-frontend'


class LayoutTests(unittest.TestCase):
    def test_six_pages_with_their_sections(self):
        self.assertEqual([page['id'] for page in PAGES],
                         ['home', 'graphics', 'game', 'controls', 'achievements', 'system'])
        for page in PAGES:
            with self.subTest(page=page['id']):
                self.assertEqual(page['sections'], SECTION_ORDER.get(page['id'], []))

    def test_every_field_sits_in_a_section_of_its_page(self):
        pages = {page['id']: page for page in PAGES}
        for field in FIELDS:
            with self.subTest(key=field['key']):
                self.assertIn(field['page'], pages)
                self.assertNotEqual(field['page'], 'home')
                self.assertIn(field['section'], pages[field['page']]['sections'])
                self.assertTrue(field['summary'].strip())
                self.assertLessEqual(len(field['summary']), 90, 'summaries are one short line')

    def test_advanced_fields_are_the_advanced_section(self):
        for field in FIELDS:
            with self.subTest(key=field['key']):
                self.assertEqual(field['advanced'], field['section'] == 'Advanced')

    def test_dependent_fields_follow_a_switch_on_the_same_page(self):
        by_key = {field['key']: field for field in FIELDS}
        dependent = [field for field in FIELDS if field['depends_on']]
        self.assertTrue(dependent)
        for field in dependent:
            with self.subTest(key=field['key']):
                parent = by_key[field['depends_on']]
                self.assertEqual(parent['kind'], 'boolean')
                self.assertEqual((parent['page'], parent['section']), (field['page'], field['section']))

    def test_hdr_settings_show_only_with_hdr_on(self):
        by_key = {field['key']: field for field in FIELDS}
        for key in ('hdr_paper_white', 'hdr_peak', 'hdr_knee'):
            self.assertEqual(by_key[key]['depends_on'], 'hdr')

    def test_the_window_loads_the_readable_launcher(self):
        index = (FRONTEND / 'index.html').read_text(encoding='utf-8')
        self.assertIn('/assets/launcher.js', index)
        self.assertIn('/assets/launcher.css', index)
        for name in re.findall(r'/assets/([\w.-]+)', index):
            with self.subTest(asset=name):
                self.assertTrue((FRONTEND / 'assets' / name).is_file())
        self.assertFalse(list((FRONTEND / 'assets').glob('index-*.js')),
                         'the minified bundle was replaced by launcher.js')

    def test_the_launcher_reads_fields_by_real_keys(self):
        script = (FRONTEND / 'assets/launcher.js').read_text(encoding='utf-8')
        keys = {field['key'] for field in FIELDS}
        for key in set(re.findall(r'f\.key === "([a-z0-9_]+)"', script)):
            with self.subTest(key=key):
                self.assertIn(key, keys)
