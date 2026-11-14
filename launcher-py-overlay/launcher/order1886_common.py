# SPDX-License-Identifier: GPL-2.0-or-later
"""Launch command with the Game & Content language, layered over the shipped helpers."""
import sys

from launcher import _order1886_common_base as _base

_backend_command = _base.backend_command


def game_system_language(values):
    """The PS4 system-language ID the player picked, or None to follow the launcher language."""
    from launcher.order1886_options import GAME_LANGUAGE_IDS
    choice = values.get("game_language", "follow")
    return GAME_LANGUAGE_IDS.get(choice) if isinstance(choice, str) else None


def game_menu_enabled(values):
    """The in-game menu (F1) follows game_menu, on by default; the old in_game_menu is ignored."""
    choice = values.get("game_menu", True)
    return choice if isinstance(choice, bool) else True


def backend_command(values, *args, **kwargs):
    # The worker merges saved settings over the defaults, so a stored in_game_menu=False from the
    # old opt-in field would win; decide it here from game_menu instead.
    values = {**values, "in_game_menu": game_menu_enabled(values)}
    command = _backend_command(values, *args, **kwargs)
    language = game_system_language(values)
    if language is not None and "--system-language" in command:
        command[command.index("--system-language") + 1] = str(language)
    return command


_load_launch_settings = _base.load_launch_settings


def load_launch_settings(state, saved=None):
    """The shipped defaults; the in-game menu (F1) follows game_menu, which is on by default."""
    if saved is None:
        saved = _base.read_settings(state / "settings.json")
    values = _load_launch_settings(state, saved)
    values["game_menu"] = values["in_game_menu"] = game_menu_enabled(saved)  # the launcher shows game_menu
    return values


backend_command.__doc__ = _backend_command.__doc__
_base.game_system_language = game_system_language
_base.backend_command = backend_command
_base.load_launch_settings = load_launch_settings
sys.modules[__name__] = _base
