#!/usr/bin/env python3
"""Validate location detail JSON files against the schema and regenerate masterlist.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

ROOT = Path(__file__).resolve().parents[1]
LOCATIONS_DIR = ROOT / "Locations"
MASTERLIST_PATH = ROOT / "masterlist.json"
SCHEMA_PATH = ROOT / "schemas" / "location-detail.schema.json"


def error(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)


def load_json(path: Path) -> object | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        error(f"{path.relative_to(ROOT)}: invalid JSON ({exc})")
        return None
    except OSError as exc:
        error(f"{path.relative_to(ROOT)}: unable to read file ({exc})")
        return None


def load_validator() -> Draft202012Validator | None:
    schema_data = load_json(SCHEMA_PATH)
    if not isinstance(schema_data, dict):
        error(f"{SCHEMA_PATH.relative_to(ROOT)}: schema must be a JSON object")
        return None

    try:
        return Draft202012Validator(schema_data)
    except SchemaError as exc:
        error(f"{SCHEMA_PATH.relative_to(ROOT)}: invalid schema ({exc.message})")
        return None


def format_validation_errors(path: Path, errors: list) -> None:
    rel_path = path.relative_to(ROOT).as_posix()
    for err in errors:
        location = ".".join(str(part) for part in err.absolute_path) or "(root)"
        error(f"{rel_path}: {location} — {err.message}")


def validate_location_file(path: Path, validator: Draft202012Validator) -> dict | None:
    data = load_json(path)
    if data is None:
        return None
    if not isinstance(data, dict):
        error(f"{path.relative_to(ROOT)}: must be a JSON object")
        return None

    errors = sorted(validator.iter_errors(data), key=lambda err: list(err.path))
    if errors:
        format_validation_errors(path, errors)
        return None

    return data


def build_master_entry(path: Path, data: dict) -> dict:
    return {
        "name": data["name"],
        "address": data["address"],
        "city": data["city"],
        "state": data["state"],
        "zip": data["zip"],
        "category": data["category"],
        "filePath": path.relative_to(ROOT).as_posix(),
    }


def collect_location_files() -> list[Path]:
    if not LOCATIONS_DIR.is_dir():
        error("Locations/ directory is missing")
        return []

    return sorted(LOCATIONS_DIR.rglob("*.json"))


def write_masterlist(entries: list[dict]) -> None:
    master_data = {"locations": entries}
    with MASTERLIST_PATH.open("w", encoding="utf-8") as handle:
        json.dump(master_data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main() -> int:
    print("Validating location files and generating masterlist.json...")

    validator = load_validator()
    if validator is None:
        return 1

    location_files = collect_location_files()
    if not location_files:
        error("No location JSON files found under Locations/")
        return 1

    entries: list[dict] = []
    seen_names: set[str] = set()
    ok = True

    for path in location_files:
        rel_path = path.relative_to(ROOT).as_posix()
        print(f"Validating {rel_path}...")

        data = validate_location_file(path, validator)
        if data is None:
            ok = False
            continue

        name = data["name"]
        if name in seen_names:
            error(f"{rel_path}: duplicate location name '{name}'")
            ok = False
            continue

        seen_names.add(name)
        entries.append(build_master_entry(path, data))

    if not ok:
        print("Validation failed — masterlist.json was NOT updated.", file=sys.stderr)
        return 1

    entries.sort(key=lambda entry: entry["name"].casefold())
    write_masterlist(entries)

    print(f"Generated masterlist.json with {len(entries)} location(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())