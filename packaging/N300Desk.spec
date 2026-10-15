# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from pathlib import Path
import sys
import os

hiddenimports = []
hiddenimports += collect_submodules('winrt')
project_root = Path(SPECPATH).parent
configuration = os.environ.get('BUILD_CONFIGURATION', 'Release')
if configuration not in ('Debug', 'Release'):
    raise ValueError('BUILD_CONFIGURATION must be Debug or Release')
is_debug = configuration == 'Debug'


a = Analysis(
    [str(project_root / 'src' / 'n300_desk' / '__main__.py')],
    pathex=[str(project_root / 'src')],
    binaries=[],
    datas=[(str(project_root / 'src' / 'n300_desk' / 'settings-catalog.json'), 'n300_desk')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['fitz', 'pymupdf', 'zxingcpp', 'numpy'],
    noarchive=False,
    optimize=0 if is_debug else 1,
)
# Conda's base environment can shadow the active environment's Tcl DLLs.
# Keep the bundled runtime aligned with the Tcl/Tk data found by the hook.
tk_bin = Path(sys.base_prefix) / 'Library' / 'bin'
for name in ('tcl86t.dll', 'tk86t.dll'):
    actual = tk_bin / name
    if actual.is_file():
        a.binaries = [entry for entry in a.binaries if entry[0].lower() != name]
        a.binaries.append((name, str(actual), 'BINARY'))
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='N300Desk',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=is_debug,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='N300Desk',
)
