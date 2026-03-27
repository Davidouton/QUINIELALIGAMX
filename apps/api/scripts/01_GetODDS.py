#!/usr/bin/env python3
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    load_env_file(Path(__file__).resolve().parents[1] / ".env")
    load_env_file(backend_dir / ".env")
    sys.path.insert(0, str(backend_dir))
    runpy.run_path(str(backend_dir / "scripts" / "pull_odds_raw.py"), run_name="__main__")


if __name__ == "__main__":
    main()
