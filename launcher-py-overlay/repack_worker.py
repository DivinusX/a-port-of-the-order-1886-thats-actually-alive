#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Put the launcher's Python overlay into an already-built worker (bin/order1886-worker).

The worker is a PyInstaller one-dir build whose Python modules live in a PYZ archive inside
the executable's `pydata` ELF section. This rewrites that archive:

  - launcher-py-overlay/launcher/X.py replaces launcher.X, and the shipped module stays as
    launcher._X_base (the overlay modules import it and add to it);
  - scripts/order1886_patches.py and scripts/order1886_editions.py from this repository
    replace scripts.order1886_patches / scripts.order1886_editions. The worker's PyInstaller
    finder maps its _internal/scripts folder to those archive entries, so the .py files on
    disk next to the worker are NOT what it runs for these two modules.

Run it with the same Python minor version as the worker (the bytecode must match; the
worker's version is in _internal/libpython3.*.so). It needs objcopy (binutils).

  python3.15 launcher-py-overlay/repack_worker.py "<package>/bin/order1886-worker/order1886-worker"

The original is kept as order1886-worker.orig unless --no-backup is given. Running it twice
is refused (the archive would already hold launcher._*_base).
"""
import argparse
import importlib.util
import marshal
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SCRIPTS = ('order1886_patches', 'order1886_editions')
MAGIC = b'MEI\x0c\x0b\x0a\x0b\x0e'


def compile_module(path, archive_name):
    code = compile(path.read_text(encoding='utf-8'), archive_name, 'exec', dont_inherit=True, optimize=0)
    return zlib.compress(marshal.dumps(code), 9)


def repack(exe: Path) -> bytes:
    data = exe.read_bytes()
    cookie_at = data.rfind(MAGIC)
    if cookie_at < 0:
        raise SystemExit(f'{exe} is not a PyInstaller executable')
    cookie = data[cookie_at:cookie_at + 88]
    _, pkglen, tocoff, toclen, pyver = struct.unpack('!8sIIII', cookie[:24])
    if pyver != sys.version_info.major * 100 + sys.version_info.minor:
        raise SystemExit(f'the worker was built with Python {pyver // 100}.{pyver % 100}; run this '
                         f'with that version, not {sys.version_info.major}.{sys.version_info.minor}')
    start = cookie_at + 88 - pkglen
    pkg = data[start:start + pkglen]

    entries, pos, toc = [], 0, pkg[tocoff:tocoff + toclen]
    while pos < len(toc):
        elen, off, clen, ulen, cflag, typ = struct.unpack('!IIIIBc', toc[pos:pos + 18])
        entries.append([toc[pos + 18:pos + elen], off, clen, ulen, cflag, typ, elen])
        pos += elen
    pyz_entry = next(e for e in entries if e[5] == b'z')
    if pyz_entry is not entries[-1] or pyz_entry[1] + pyz_entry[2] != tocoff:
        raise SystemExit('unexpected archive layout: the PYZ is not the last entry')

    pyz = pkg[pyz_entry[1]:pyz_entry[1] + pyz_entry[2]]
    if pyz[:4] != b'PYZ\0' or pyz[4:8] != importlib.util.MAGIC_NUMBER:
        raise SystemExit('the PYZ bytecode magic does not match this Python')
    tocpos = struct.unpack('!i', pyz[8:12])[0]
    items = marshal.loads(pyz[tocpos:])
    first = min(value[1] for _, value in items)
    header, body = bytearray(pyz[:first]), bytearray(pyz[first:tocpos])
    names = dict(items)

    for path in sorted((HERE / 'launcher').glob('*.py')):
        module, base = 'launcher.' + path.stem, 'launcher._' + path.stem + '_base'
        if module not in names:
            raise SystemExit(f'{module} is not in this worker')
        if base in names:
            raise SystemExit(f'{base} already exists: this worker was repacked before')
        blob = compile_module(path, 'launcher/' + path.name)
        items = [(base, value) if name == module else (name, value) for name, value in items]
        items.append((module, (0, first + len(body), len(blob))))
        body += blob
        print(f'overlay  {module} (shipped module kept as {base})')
    for stem in SCRIPTS:
        module = 'scripts.' + stem
        if module not in names:
            raise SystemExit(f'{module} is not in this worker')
        blob = compile_module(REPO / 'scripts' / (stem + '.py'), f'scripts/{stem}.py')
        items = [(name, (names[module][0], first + len(body), len(blob))) if name == module
                 else (name, value) for name, value in items]
        body += blob
        print(f'replace  {module} (from scripts/{stem}.py)')

    struct.pack_into('!i', header, 8, first + len(body))
    new_pyz = bytes(header) + bytes(body) + marshal.dumps(items)
    pyz_entry[2] = pyz_entry[3] = len(new_pyz)
    new_toc = b''.join(struct.pack('!IIIIBc', e[6], e[1], e[2], e[3], e[4], e[5]) + e[0] for e in entries)
    new_tocoff = pyz_entry[1] + len(new_pyz)
    new_cookie = struct.pack('!8sIIII', MAGIC, new_tocoff + toclen + 88, new_tocoff, toclen, pyver) + cookie[24:]
    return pkg[:pyz_entry[1]] + new_pyz + new_toc + new_cookie


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('worker', type=Path, help='bin/order1886-worker/order1886-worker')
    parser.add_argument('--no-backup', action='store_true')
    args = parser.parse_args()
    exe = args.worker.resolve()
    if shutil.which('objcopy') is None:
        raise SystemExit('objcopy (binutils) is required')
    section = repack(exe)
    with tempfile.TemporaryDirectory() as temporary:
        pydata, out = Path(temporary) / 'pydata.bin', Path(temporary) / 'worker'
        pydata.write_bytes(section)
        subprocess.run(['objcopy', '--update-section', f'pydata={pydata}', str(exe), str(out)], check=True)
        if not args.no_backup:
            shutil.copy2(exe, exe.with_name(exe.name + '.orig'))
        shutil.copymode(exe, out)
        os.replace(out, exe) if out.stat().st_dev == exe.stat().st_dev else shutil.move(out, exe)
    print(f'wrote {exe}')


if __name__ == '__main__':
    main()
