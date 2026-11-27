"""A settings change made in the in-game menu survives to the launcher, and never the reverse."""
from pathlib import Path
import os
import tempfile
import unittest

import order1886
from launcher import order1886_worker as worker

ROOT = Path(__file__).resolve().parents[1]


def write_ini(state, **pairs):
    body = '# The Order: 1886 runtime settings\n' + ''.join(f'{k}={v}\n' for k, v in pairs.items())
    (state / 'runtime.ini').write_text(body, encoding='utf-8')


def age(state, name, seconds):
    stamp = (state / name).stat().st_mtime + seconds
    os.utime(state / name, (stamp, stamp))


class ImportTests(unittest.TestCase):
    def test_a_newer_runtime_ini_imports_the_menu_choices(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, display_mode='fullscreen', vsync='0', show_fps='1',
                      presentation_filter='linear', mouse_look='0', mouse_invert_y='1',
                      mouse_sensitivity='250', fps_limit='60')
            age(state, 'runtime.ini', 5)
            changed = order1886.menu_settings_import(state, {'display_mode': 'borderless',
                                                             'vsync': True, 'frame_rate': 30})
            self.assertEqual(changed['display_mode'], 'fullscreen')
            self.assertIs(changed['vsync'], False)
            self.assertIs(changed['show_fps'], True)
            self.assertEqual(changed['presentation_filter'], 'linear')
            self.assertIs(changed['mouse_look'], False)
            self.assertIs(changed['mouse_invert_y'], True)
            self.assertEqual(changed['mouse_sensitivity'], 250)
            self.assertEqual(changed['frame_rate'], 60)

    def test_hdr_menu_choices_are_imported_within_their_ranges(self):
        # F1 > Graphics > HDR (#66): the runtime writes hdr, paper white, peak and highlight start.
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, hdr='1', hdr_paper_white='250', hdr_peak='800', hdr_knee='85')
            age(state, 'runtime.ini', 5)
            changed = order1886.menu_settings_import(state, {'hdr': False, 'hdr_paper_white': 200,
                                                             'hdr_peak': 1000, 'hdr_knee': 80})
            self.assertIs(changed['hdr'], True)
            self.assertEqual((changed['hdr_paper_white'], changed['hdr_peak'], changed['hdr_knee']),
                             (250, 800, 85))
            write_ini(state, hdr_paper_white='20', hdr_peak='99999', hdr_knee='x')
            age(state, 'runtime.ini', 10)
            self.assertEqual(order1886.menu_settings_import(state, {'hdr_paper_white': 200}), {})

    def test_an_older_runtime_ini_never_overwrites_a_launcher_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            write_ini(state, display_mode='fullscreen', vsync='0')
            age(state, 'runtime.ini', -30)
            (state / 'settings.json').write_text('{"display_mode": "windowed"}', encoding='utf-8')
            self.assertEqual(order1886.menu_settings_import(state, {'display_mode': 'windowed'}), {})

    def test_unchanged_values_report_no_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, display_mode='borderless', vsync='1')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {'display_mode': 'borderless',
                                                                    'vsync': True}), {})

    def test_a_missing_or_corrupt_file_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            self.assertEqual(order1886.menu_settings_import(state, {}), {})
            (state / 'runtime.ini').write_text('garbage\n=\nvsync=maybe\nmouse_sensitivity=9999\n'
                                               'display_mode=sideways\nfps_limit=90\n', encoding='utf-8')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {}), {})

    def test_unparsable_lines_do_not_hide_the_parsable_ones(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            (state / 'runtime.ini').write_text('vsync=notanumber\nshow_fps=1\n', encoding='utf-8')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {'show_fps': False}),
                             {'show_fps': True})

    def test_the_menu_output_resolution_is_imported(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, output_res='3840x2160', menu_settings='2')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {'output_resolution': 'automatic'}),
                             {'output_resolution': '3840x2160'})
            write_ini(state, output_res='1234x567', menu_settings='2')
            age(state, 'runtime.ini', 10)
            self.assertEqual(order1886.menu_settings_import(state, {'output_resolution': 'automatic'}), {})

    def test_the_menu_frame_rate_maps_onto_the_launcher_rate_and_cap(self):
        cases = [
            # (menu_frame_rate, launcher values, expected change)
            ('60', {'frame_rate': 30, 'fps_cap': 120}, {'frame_rate': 60}),
            ('90', {'frame_rate': 30, 'fps_cap': 60}, {'frame_rate': 90, 'fps_cap': 90}),
            ('144', {'frame_rate': 30, 'fps_cap': 120}, {'frame_rate': 0, 'fps_cap': 144}),
            ('0', {'frame_rate': 60, 'fps_cap': 120}, {'frame_rate': 0, 'fps_cap': 240}),
            ('30', {'frame_rate': 30, 'fps_cap': 120}, {}),
            ('999', {'frame_rate': 30, 'fps_cap': 120}, {}),
        ]
        for rate, values, expected in cases:
            with self.subTest(rate=rate), tempfile.TemporaryDirectory() as temporary:
                state = Path(temporary)
                (state / 'settings.json').write_text('{}', encoding='utf-8')
                write_ini(state, fps_limit='60', menu_settings='2', menu_frame_rate=rate)
                age(state, 'runtime.ini', 5)
                self.assertEqual(order1886.menu_settings_import(state, values), expected)

    def test_without_a_menu_rate_the_presentation_cap_is_not_read_as_the_game_rate(self):
        # Launcher: 90 FPS with a 60 cap, so the runtime runs fps_limit=60. A menu save that did
        # not touch the frame rate must not turn the launcher's 90 into 60.
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, fps_limit='60', vsync='0', menu_settings='2')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {'frame_rate': 90, 'fps_cap': 60,
                                                                    'vsync': True}),
                             {'vsync': False})

    def test_the_runtime_writes_the_keys_the_launcher_imports(self):
        source = (ROOT / 'gpu' / 'shim' / 'ps4_settings.cpp').read_text(encoding='utf-8')
        for key in ('output_res=', 'menu_settings=2', 'menu_frame_rate='):
            self.assertIn(key, source)
        gpu = (ROOT / 'gpu' / 'shim' / 'ps4gpu.cpp').read_text(encoding='utf-8')
        self.assertIn('Ps4Overlay::SaveChangedSettings()', gpu)

    def test_an_engine_rate_the_launcher_does_not_offer_is_not_adopted(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / 'settings.json').write_text('{}', encoding='utf-8')
            write_ini(state, fps_limit='90')
            age(state, 'runtime.ini', 5)
            self.assertEqual(order1886.menu_settings_import(state, {'frame_rate': 30}), {})


class WorkerPersistenceTests(unittest.TestCase):
    def test_the_worker_adopts_and_persists_a_menu_change_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            app = worker.Worker(state, ROOT)
            app.dispatch('settings.set', {'values': {'display_mode': 'borderless'}})
            write_ini(state, display_mode='fullscreen', vsync='1')
            age(state, 'runtime.ini', 5)
            values = app.snapshot()['settings']
            self.assertEqual(values['display_mode'], 'fullscreen')
            # Persisted, so the next read does not depend on the ini being newer again.
            self.assertEqual(app.settings()['display_mode'], 'fullscreen')
            age(state, 'runtime.ini', -30)
            self.assertEqual(app.snapshot()['settings']['display_mode'], 'fullscreen')


if __name__ == '__main__':
    unittest.main()
