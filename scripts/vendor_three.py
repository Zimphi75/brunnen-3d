"""Lädt three.js r160 und die benötigten Addons lokal nach public/vendor/three/ (rekursiv über Importe).

Aufruf: python scripts/vendor_three.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import requests

VERSION = "0.160.0"
BASE = f"https://cdn.jsdelivr.net/npm/three@{VERSION}"
TARGET = Path(__file__).resolve().parent.parent / "public" / "vendor" / "three"
ENTRY_POINTS = [
    "build/three.module.js",
    "examples/jsm/controls/OrbitControls.js",
    "examples/jsm/postprocessing/EffectComposer.js",
    "examples/jsm/postprocessing/RenderPass.js",
    "examples/jsm/postprocessing/ShaderPass.js",
    "examples/jsm/postprocessing/OutputPass.js",
    "examples/jsm/postprocessing/GTAOPass.js",
    "examples/jsm/postprocessing/UnrealBloomPass.js",
    "examples/jsm/utils/BufferGeometryUtils.js",
    "examples/jsm/objects/Sky.js",
]
IMPORT_PATTERN = re.compile(r"""from\s+['"](\.[^'"]+)['"]""")


def fetch(path: str, done: set[str]) -> None:
    if path in done:
        return
    done.add(path)
    destination = TARGET / path
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(f"{BASE}/{path}", timeout=60)
        response.raise_for_status()
        destination.write_bytes(response.content)
        print("geladen:", path)
    for relative in IMPORT_PATTERN.findall(destination.read_text(encoding="utf-8")):
        resolved = (Path(path).parent / relative)
        parts: list[str] = []
        for part in resolved.parts:
            if part == "..":
                parts.pop()
            elif part != ".":
                parts.append(part)
        fetch("/".join(parts), done)


def main() -> int:
    done: set[str] = set()
    for entry in ENTRY_POINTS:
        fetch(entry, done)
    print(f"{len(done)} Dateien in {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
