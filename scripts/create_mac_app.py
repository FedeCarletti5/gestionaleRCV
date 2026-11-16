#!/usr/bin/env python3
"""
Crea l'applicazione macOS nativa 'GestionaleRCV.app' con icona .icns personalizzata
e la installa sulla Scrivania (Desktop) del Mac.
"""
import os
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
LOGO_PNG = BASE_DIR / "frontend" / "assets" / "logo.png"
APP_NAME = "GestionaleRCV"
APP_URL = "https://fedecarletti5.github.io/gestionaleRCV/"


def build_icns(source_png: Path, target_icns: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir(parents=True, exist_ok=True)
        sizes = [
            (16, "icon_16x16.png"),
            (32, "icon_16x16@2x.png"),
            (32, "icon_32x32.png"),
            (64, "icon_32x32@2x.png"),
            (128, "icon_128x128.png"),
            (256, "icon_128x128@2x.png"),
            (256, "icon_256x256.png"),
            (512, "icon_256x256@2x.png"),
            (512, "icon_512x512.png"),
            (1024, "icon_512x512@2x.png"),
        ]
        for px, name in sizes:
            out_file = iconset / name
            subprocess.run(
                ["/usr/bin/sips", "-s", "format", "png", "-z", str(px), str(px), str(source_png), "--out", str(out_file)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        subprocess.run(
            ["/usr/bin/iconutil", "-c", "icns", str(iconset), "-o", str(target_icns)],
            check=True,
        )


def create_app_bundle(dest_dir: Path) -> Path:
    app_path = dest_dir / f"{APP_NAME}.app"
    if app_path.exists():
        shutil.rmtree(app_path)

    contents = app_path / "Contents"
    macos_dir = contents / "MacOS"
    resources_dir = contents / "Resources"
    macos_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)

    icns_path = resources_dir / "AppIcon.icns"
    build_icns(LOGO_PNG, icns_path)

    info_plist = {
        "CFBundleDevelopmentRegion": "it",
        "CFBundleDisplayName": APP_NAME,
        "CFBundleExecutable": APP_NAME,
        "CFBundleIconFile": "AppIcon",
        "CFBundleIconName": "AppIcon",
        "CFBundleIdentifier": "it.federicocarletti.gestionalercv",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": APP_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "12.0",
        "NSHighResolutionCapable": True,
    }
    with open(contents / "Info.plist", "wb") as f:
        plistlib.dump(info_plist, f)

    launcher = macos_dir / APP_NAME
    launcher.write_text(
        f"""#!/bin/sh
/usr/bin/open "{APP_URL}"
""",
        encoding="utf-8",
    )
    os.chmod(launcher, 0o755)
    subprocess.run(["/usr/bin/touch", str(app_path)], check=False)
    return app_path


if __name__ == "__main__":
    desktop = Path.home() / "Desktop"
    target = desktop if desktop.exists() else BASE_DIR
    out = create_app_bundle(target)
    print(f"Creata app macOS: {out}")
