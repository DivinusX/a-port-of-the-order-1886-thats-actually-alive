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


def backend_command(values, *args, **kwargs):
    command = _backend_command(values, *args, **kwargs)
    language = game_system_language(values)
    if language is not None and "--system-language" in command:
        command[command.index("--system-language") + 1] = str(language)
    return command


backend_command.__doc__ = _backend_command.__doc__
_base.game_system_language = game_system_language
_base.backend_command = backend_command
sys.modules[__name__] = _base
