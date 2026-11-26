#!/usr/bin/env python3
"""Packaging tool for Paperboat station packages (.pst).

Packs a verified station directory into a reproducible zip archive with PACKAGE.json
and file integrity hashes, excluding build artifacts and ignore patterns.
Unpacks and verifies file hashes.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

DEFAULT_IGNORES = [
    "build",
    "build/*",
    "build/**",
    "cmake-build-*",
    "cmake-build-*/**",
    ".paperboat-build.stamp",
    "__pycache__",
    "__pycache__/*",
    "__pycache__/**",
    "*.pyc",
    "*.pyo",
    ".venv",
    ".venv/**",
    ".julia",
    ".julia/**",
    "venv",
    "venv/**",
    ".git",
    ".git/**",
    ".DS_Store",
    "Thumbs.db",
    "*.o",
    "*.a",
    "*.so",
    "*.dylib",
    "*.dll",
    "*.pst",
    "*.paperboat-pkg",
    "*.insyncdl",
    ".~*",
]


def load_ignore_patterns(station_dir: Path) -> list[str]:
    patterns = list(DEFAULT_IGNORES)
    ignore_file = station_dir / ".paperboatignore"
    if ignore_file.is_file():
        for line in ignore_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


def is_ignored(rel_path: str, patterns: list[str]) -> bool:
    norm = rel_path.replace("\\", "/")
    parts = norm.split("/")
    for pat in patterns:
        pat_norm = pat.replace("\\", "/")
        if pat_norm.endswith("/"):
            dir_pat = pat_norm.rstrip("/")
            if any(fnmatch.fnmatch(p, dir_pat) for p in parts[:-1]):
                return True
        if fnmatch.fnmatch(norm, pat_norm) or any(fnmatch.fnmatch(p, pat_norm) for p in parts):
            return True
        if fnmatch.fnmatch(norm, pat_norm + "/*") or fnmatch.fnmatch(norm, pat_norm + "/**"):
            return True
    return False


def progress(done: int, total: int, nbytes: int) -> None:
    """One NDJSON progress line on stderr; `paperboat pack|unpack --json-stream` forwards it."""
    print(json.dumps({"files": done, "total": total, "bytes": nbytes}), file=sys.stderr, flush=True)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def walk_files(top: Path, base: Path, patterns: list[str]) -> dict[str, Path]:
    """Every file under `top` not ignored, keyed by its archive path (relative to `base`)."""
    found = {}
    for root, dirs, files in os.walk(top):
        rel_root = os.path.relpath(root, base)
        if rel_root != "." and is_ignored(rel_root, patterns):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if not is_ignored(os.path.join(rel_root, d) if rel_root != "." else d, patterns)]
        for file in files:
            rel_norm = (os.path.join(rel_root, file) if rel_root != "." else file).replace("\\", "/")
            full_path = Path(root) / file
            if not is_ignored(rel_norm, patterns) and full_path.is_file():
                found[rel_norm] = full_path
    return found


def bundle_deps(station_dir: Path, tmp: Path) -> dict[str, Path] | str:
    """The environment a station's lockfile names, for an offline install (#322): Python wheels
    built into wheels/ (what `paperboat deps install` installs from), or the Julia depot .julia/."""
    if (station_dir / "Project.toml").is_file():
        depot = station_dir / ".julia"
        if not depot.is_dir():
            return "no .julia depot to bundle: run `paperboat deps install` first"
        return walk_files(depot, station_dir, [])
    reqs = station_dir / "requirements.txt"
    if reqs.is_file() or (station_dir / "pyproject.toml").is_file():
        wheels = tmp / "wheels"
        what = ["-r", str(reqs)] if reqs.is_file() else [str(station_dir)]
        proc = subprocess.run(
            [sys.executable, "-m", "pip", "wheel", "--disable-pip-version-check", "-q", "-w", str(wheels), *what],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            return f"pip wheel failed: {proc.stderr.strip() or proc.stdout.strip()}"
        return walk_files(wheels, tmp, []) if wheels.is_dir() else {}
    return "no requirements.txt, pyproject.toml or Project.toml to bundle"


def deps_kind(station_dir: Path) -> str:
    for lock in ("requirements.txt", "pyproject.toml", "Project.toml"):
        if (station_dir / lock).is_file():
            return "lockfile"
    return ""


def cmd_pack(station_dir: Path, out_path: Path, bundle: bool = False) -> dict:
    if not station_dir.is_dir():
        return {"ok": False, "error": f"directory not found: {station_dir}"}

    manifest_file = station_dir / "station.toml"
    if not manifest_file.is_file():
        return {"ok": False, "error": f"station.toml missing in {station_dir}"}

    try:
        try:
            import tomllib
        except ImportError:
            import tomli as tomllib
        manifest = tomllib.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": f"failed to parse station.toml: {e}"}

    station_info = manifest.get("station", {})
    name = station_info.get("name")
    if not name:
        return {"ok": False, "error": "station.toml missing 'name'"}

    version = station_info.get("version", "0.1.0")
    language = station_info.get("language", "unknown")
    engine = station_info.get("engine", ">=0.1")

    patterns = load_ignore_patterns(station_dir)

    sources = walk_files(station_dir, station_dir, patterns)
    deps = deps_kind(station_dir)
    with tempfile.TemporaryDirectory() as tmp:
        if bundle:
            extra = bundle_deps(station_dir, Path(tmp))
            if isinstance(extra, str):
                return {"ok": False, "error": extra}
            sources.update(extra)
            deps = "bundled"
        return write_package(sources, out_path, name, version, language, engine, deps)


def write_package(sources: dict[str, Path], out_path: Path, name, version, language, engine, deps) -> dict:
    files_to_pack = sorted(sources)

    manifest_files = []
    total_bytes = 0
    for rel in files_to_pack:
        p = sources[rel]
        size = p.stat().st_size
        total_bytes += size
        digest = sha256_file(p)
        manifest_files.append({"path": rel, "size": size, "sha256": digest})

    pkg_meta = {
        "format": 0,
        "name": name,
        "version": version,
        "language": language,
        "engine": engine,
        "manifest": "station.toml",
        "files": manifest_files,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("PACKAGE.json", json.dumps(pkg_meta, indent=2))
        written = 0
        for i, rel in enumerate(files_to_pack, 1):
            zf.write(sources[rel], arcname=rel)
            written += sources[rel].stat().st_size
            progress(i, len(files_to_pack), written)

    archive_digest = sha256_file(out_path)
    return {
        "ok": True,
        "package": str(out_path),
        "name": name,
        "version": version,
        "file_count": len(files_to_pack),
        "total_bytes": total_bytes,
        "sha256": archive_digest,
        "deps": deps,
    }


def cmd_unpack(pkg_path: Path, dest_dir: Path, verify: bool) -> dict:
    if not pkg_path.is_file():
        return {"ok": False, "error": f"package file not found: {pkg_path}"}

    try:
        zf = zipfile.ZipFile(pkg_path, "r")
    except Exception as e:
        return {"ok": False, "error": f"corrupted zip archive: {e}"}

    with zf:
        namelist = zf.namelist()
        if "PACKAGE.json" not in namelist:
            return {"ok": False, "error": "invalid package: PACKAGE.json missing in archive"}

        try:
            pkg_meta = json.loads(zf.read("PACKAGE.json").decode("utf-8"))
        except Exception as e:
            return {"ok": False, "error": f"invalid PACKAGE.json: {e}"}

        name = pkg_meta.get("name", "unknown")
        version = pkg_meta.get("version", "0.1.0")

        # Security check: disallow path traversal
        for member in namelist:
            if member.startswith("/") or member.startswith("\\") or ".." in member.split("/"):
                return {"ok": False, "error": f"malicious entry in package: {member}"}

        dest_dir.mkdir(parents=True, exist_ok=True)

        # Extract files
        members = [m for m in zf.infolist() if m.filename != "PACKAGE.json"]
        extracted = 0
        for i, member in enumerate(members, 1):
            zf.extract(member, path=dest_dir)
            extracted += member.file_size
            progress(i, len(members), extracted)

        if verify and "files" in pkg_meta:
            for item in pkg_meta["files"]:
                target = dest_dir / item["path"]
                if not target.is_file():
                    return {"ok": False, "error": f"missing extracted file: {item['path']}"}
                actual_hash = sha256_file(target)
                if actual_hash != item["sha256"]:
                    return {
                        "ok": False,
                        "error": f"checksum mismatch for {item['path']}: expected {item['sha256']}, got {actual_hash}",
                    }

    return {
        "ok": True,
        "dir": str(dest_dir),
        "name": name,
        "version": version,
        "file_count": len(pkg_meta.get("files", [])),
    }


def cmd_info(paths: list[Path]) -> dict:
    """Each .pst's station: its name and version (station.toml read in the zip, else PACKAGE.json) and its sha256."""
    out = []
    for p in paths:
        try:
            with zipfile.ZipFile(p) as zf:
                names = zf.namelist()
                info = {}
                if "station.toml" in names:
                    try:
                        import tomllib
                    except ImportError:
                        import tomli as tomllib
                    info = tomllib.loads(zf.read("station.toml").decode("utf-8")).get("station", {})
                elif "PACKAGE.json" in names:
                    info = json.loads(zf.read("PACKAGE.json").decode("utf-8"))
            if not isinstance(info.get("name"), str):
                raise ValueError("no station.toml with a name")
            out.append({"path": str(p), "name": info["name"], "version": str(info.get("version", "0.1.0")), "sha256": sha256_file(p)})
        except Exception as e:
            out.append({"path": str(p), "error": str(e)})
    return {"ok": True, "stations": out}


def read_manifest_info(station_dir: Path) -> tuple[str, str]:
    manifest_file = station_dir / "station.toml"
    name = station_dir.name
    version = "0.1.0"
    if manifest_file.is_file():
        try:
            try:
                import tomllib
            except ImportError:
                import tomli as tomllib
            manifest = tomllib.loads(manifest_file.read_text(encoding="utf-8"))
            station_info = manifest.get("station", {})
            name = station_info.get("name", name)
            version = station_info.get("version", version)
        except Exception:
            pass
    return name, version


def main():
    parser = argparse.ArgumentParser(description="Paperboat station packager")
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    pack_p = subparsers.add_parser("pack")
    pack_p.add_argument("pos_dir", nargs="?", type=Path, default=None, help="Station directory")
    pack_p.add_argument("--dir", type=Path, default=None, help="Station directory to pack")
    pack_p.add_argument("--out", type=Path, default=None, help="Output package path (.pst)")
    pack_p.add_argument("--bundle-deps", action="store_true", help="Add wheels/ (Python) or .julia/ (Julia)")

    unpack_p = subparsers.add_parser("unpack")
    unpack_p.add_argument("pos_pkg", nargs="?", type=Path, default=None, help="Input package path (.pst)")
    unpack_p.add_argument("--pkg", type=Path, default=None, help="Input package path (.pst)")
    unpack_p.add_argument("--dir", type=Path, required=True, help="Target extraction directory")
    unpack_p.add_argument("--verify", action="store_true", default=True, help="Verify file checksums")

    info_p = subparsers.add_parser("info")
    info_p.add_argument("pkgs", nargs="*", type=Path, help="Package paths (.pst)")

    args = parser.parse_args()

    if args.subcommand == "pack":
        src_dir = (args.dir or args.pos_dir or Path(".")).resolve()
        out_pkg = args.out
        if out_pkg is None:
            name, version = read_manifest_info(src_dir)
            out_pkg = Path(f"{name}-{version}.pst")
        res = cmd_pack(src_dir, out_pkg.resolve(), args.bundle_deps)
    elif args.subcommand == "unpack":
        pkg_file = (args.pkg or args.pos_pkg)
        if not pkg_file:
            print(json.dumps({"ok": False, "error": "missing package file"}))
            sys.exit(1)
        res = cmd_unpack(pkg_file.resolve(), args.dir.resolve(), args.verify)
    elif args.subcommand == "info":
        res = cmd_info(args.pkgs)
    else:
        res = {"ok": False, "error": "unknown subcommand"}

    print(json.dumps(res))
    sys.exit(0 if res.get("ok") else 1)


if __name__ == "__main__":
    main()
