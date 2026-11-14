# SPDX-License-Identifier: GPL-2.0-or-later
"""Game language selector on Game & Content, layered over the shipped option catalogue.

The game reads one PS4 system language (ORDER1886_LANGUAGE) for both text and voices, so
a single selector replaces the two unavailable text/voice placeholders (#21).

The executable maps the system language through its table at 0xf13370 (21 languages) and
then filters it by SKU. Without -sku it runs as SKU 0, whose filter kept only US English,
Korean and Chinese; the prepared image removes that filter (scripts/order1886_patches.py,
LANGUAGE), so every language below reaches the game. It still needs that language's assets.
"""
import sys

from launcher import _order1886_options_base as _base

# value, label, PS4 system-language ID (engine language in the comment)
GAME_LANGUAGES = (
    ("en", "English (US)", 1),                    # 0
    ("en-GB", "English (UK)", 18),                # 1
    ("es", "Español (España)", 3),                # 5
    ("es-419", "Español (Latinoamérica)", 20),    # 16
    ("fr", "Français", 2),                        # 2
    ("it", "Italiano", 5),                        # 3
    ("de", "Deutsch", 4),                         # 4
    ("nl", "Nederlands", 6),                      # 6
    ("pt-PT", "Português (Portugal)", 7),         # 7
    ("pt-BR", "Português (Brasil)", 17),          # 17
    ("ru", "Русский", 8),                         # 8
    ("pl", "Polski", 16),                         # 9
    ("sv", "Svenska", 13),                        # 10
    ("no", "Norsk", 15),                          # 11
    ("fi", "Suomi", 12),                          # 12
    ("da", "Dansk", 14),                          # 13
    ("tr", "Türkçe", 19),                         # 15
    ("ja", "日本語", 0),                           # 18
    ("ko", "한국어", 9),                           # 19
    ("zh-Hans", "简体中文", 11),                   # 20
    ("zh-Hant", "繁體中文", 10),                   # 21
)
GAME_LANGUAGE_IDS = {value: ident for value, _, ident in GAME_LANGUAGES}

_base.FIELDS[:] = [f for f in _base.FIELDS
                   if f["key"] not in ("game_text_language", "game_voice_language")]
_base.field(
    "game_language", "Game language", "game", "select", "follow",
    "Language of the game's text and voices, applied on the next launch. Follow uses the "
    "launcher language when the game supports it. The game needs that language's assets "
    "in your dump; otherwise it shows English.",
    [("follow", "Follow launcher language", "")]
    + [(value, label, "") for value, label, _ in GAME_LANGUAGES])
# Show it right after the game folder.
_fields = _base.FIELDS
_item = _fields.pop()
_fields.insert(next((i + 1 for i, f in enumerate(_fields) if f["key"] == "game_dir"), 0), _item)

# In-game menu (F1). It replaces the old opt-in "in_game_menu" field with a new key that is on
# by default: the launcher saves every key, so most players already have in_game_menu=False
# stored and a new default on the old key would never apply. order1886_common maps game_menu
# onto in_game_menu for the launch command.
_old = next((i for i, f in enumerate(_base.FIELDS) if f["key"] == "in_game_menu"), None)
_page = _base.FIELDS[_old]["page"] if _old is not None else "performance"
if _old is not None:
    del _base.FIELDS[_old]
_base.field(
    "game_menu", "In-game menu (F1)", _page, "boolean", True,
    "Press F1 in game (or R3+L2 on a controller) to change the frame rate, window mode, V-Sync, "
    "output resolution and FPS counter while you play. Changes apply immediately and last for "
    "that session.")
_fields = _base.FIELDS
_fields.insert(_old if _old is not None else len(_fields) - 1, _fields.pop())

_base.GAME_LANGUAGES = GAME_LANGUAGES
_base.GAME_LANGUAGE_IDS = GAME_LANGUAGE_IDS
sys.modules[__name__] = _base
