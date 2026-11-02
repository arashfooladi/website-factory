#!/usr/bin/env python3
"""Build deterministic MainTheme archives and check the reviewed baseline lock."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ("maintheme", "maintheme-child-starter", "maintheme-iran-commerce")
UPSTREAM = {
    "maintheme-0.4.0.zip": "cfb251154154dc0f9cad7f357512606a2380f2b2aa2bac05a43c34b635045076",
    "maintheme-child-starter-0.4.0.zip": "a328744ab2fe32e1579ca0bd6f391df99a431fba5d21d33a31c3561201c950c9",
    "maintheme-iran-commerce-0.4.0.zip": "23b96af863ebfa1ae512ee2feb2cce979d0e9fc776751acbfd05fbedc863160e",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def archive(source: Path) -> bytes:
    output = io.BytesIO()
    # These small baseline archives use STORE so hashes do not depend on the
    # Python host's zlib version. Timestamps, ordering and permissions are fixed.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as bundle:
        for path in sorted(source.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Release sources must not contain symlinks: {path}")
            if not path.is_file():
                continue
            if path.name.startswith(".") or path.suffix in {".pyc", ".log"}:
                raise ValueError(f"Unwanted release file: {path}")
            info = zipfile.ZipInfo(path.relative_to(source.parent).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_STORED
            bundle.writestr(info, path.read_bytes())
    return output.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--write-lock", action="store_true", help="Explicitly record a reviewed baseline")
    mode.add_argument("--check", action="store_true", help="Verify source and regenerated archive hashes")
    args = parser.parse_args()
    baseline = ROOT / "baseline"
    lock_path = baseline / "manifest.json"
    source = baseline / "source"
    for name, expected in UPSTREAM.items():
        if sha256((baseline / "upstream" / name).read_bytes()) != expected:
            raise ValueError(f"Original upstream archive changed: {name}")
    files = {p.relative_to(source).as_posix(): sha256(p.read_bytes())
             for p in sorted(source.rglob("*")) if p.is_file()}
    bundles = {f"{name}-0.4.0-factory.1.zip": archive(source / name) for name in PACKAGES}
    manifest = {
        "schema_version": 1,
        "upstream_version": "0.4.0",
        "baseline_revision": "0.4.0-factory.1",
        "upstream_archives": UPSTREAM,
        "source_files": files,
        "archives": {name: sha256(data) for name, data in bundles.items()},
    }
    if args.write_lock:
        lock_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        print("Recorded explicitly reviewed baseline lock.")
    elif not lock_path.exists() or json.loads(lock_path.read_text()) != manifest:
        print("FAIL: baseline drift; review changes before explicitly updating its lock.", file=sys.stderr)
        return 1
    if not args.check:
        target = ROOT / "dist" / "baseline"
        target.mkdir(parents=True, exist_ok=True)
        for name, data in bundles.items():
            (target / name).write_bytes(data)
        (target / "CHECKSUMS.txt").write_text("".join(
            f"{sha256(data)}  {name}\n" for name, data in bundles.items()))
    print(f"PASS: {len(files)} source files and {len(bundles)} deterministic archives match the baseline.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
