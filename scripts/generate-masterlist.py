#!/usr/bin/env python3
"""Generate masterlist.json from all validated Location detail files.

This makes Locations/ the single source of truth.
Run locally or via GitHub Action.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCATIONS_DIR = ROOT / "Locations"
MASTERLIST_PATH = ROOT / "masterlist.json"

VALID_CATEGORIES = {"Warehouse", "Store", "Terminal", "Other"}
REQUIRED_DETAIL_FIELDS = (
    "name", "address", "city", "state", "zip", "category",
    "latitude", "longitude", "notes"
)

def error(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)

def is_lat_lng_point(value: object, label: str, file_path: Path) -> bool:
    if not isinstance(value, dict):
        error(f"{file_path}: {label} entries must be objects")
        return False
    ok = True
    for key in ("lat", "lng"):
        if key not in value:
            error(f"{file_path}: {label} entry missing '{key}'")
            ok = False
            continue
        if not isinstance(value[key], (int, float)):
            error(f"{file_path}: {label} entry '{key}' must be a number")
            ok = False
    if ok:
        lat, lng = value["lat"], value["lng"]
        if not (-90 <= lat <= 90):
            error(f"{file_path}: {label} entry lat out of range: {lat}")
            ok = False
        if not (-180 <= lng <= 180):
            error(f"{file_path}: {label} entry lng out of range: {lng}")
            ok = False
    return ok

def validate_point_list(
    value: object,
    field_name: str,
    file_path: Path,
    *,
    min_points: int = 0,
    require_label: bool = False,
    require_name: bool = False,
) -> bool:
    if value is None:
        return True
    if not isinstance(value, list):
        error(f"{file_path}: '{field_name}' must be an array")
        return False
    if len(value) < min_points:
        error(f"{file_path}: '{field_name}' must contain at least {min_points} point(s)")
        return False

    ok = True
    for index, item in enumerate(value):
        label = f"{field_name}[{index}]"
        if not is_lat_lng_point(item, label, file_path):
            ok = False
            continue
        if require_label and not isinstance(item.get("label"), str):
            error(f"{file_path}: {label} missing string 'label'")
            ok = False
        if require_name and not isinstance(item.get("name"), str):
            error(f"{file_path}: {label} missing string 'name'")
            ok = False
    return ok

def load_json(path: Path) -> dict | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            if not isinstance(data, dict):
                error(f"{path}: must be a JSON object")
                return None
            return data
    except json.JSONDecodeError as exc:
        error(f"{path}: invalid JSON ({exc})")
        return None
    except OSError as exc:
        error(f"{path}: unable to read file ({exc})")
        return None

def validate_detail_file(path: Path, data: dict) -> bool:
    ok = True
    for field in REQUIRED_DETAIL_FIELDS:
        if field not in data:
            error(f"{path}: missing required field '{field}'")
            ok = False

    if not ok:
        return False

    if not isinstance(data["name"], str) or not data["name"].strip():
        error(f"{path}: 'name' must be a non-empty string")
        ok = False

    for coord in ("latitude", "longitude"):
        if not isinstance(data[coord], (int, float)):
            error(f"{path}: '{coord}' must be a number")
            ok = False

    if isinstance(data.get("latitude"), (int, float)) and not (-90 <= data["latitude"] <= 90):
        error(f"{path}: latitude out of range")
        ok = False
    if isinstance(data.get("longitude"), (int, float)) and not (-180 <= data["longitude"] <= 180):
        error(f"{path}: longitude out of range")
        ok = False

    if not isinstance(data["notes"], str):
        error(f"{path}: 'notes' must be a string")
        ok = False

    if data.get("category") not in VALID_CATEGORIES:
        error(f"{path}: invalid category '{data.get('category')}' ")
        ok = False

    for f in ("address", "city", "zip"):
        if not isinstance(data.get(f), str) or not data.get(f, "").strip():
            error(f"{path}: '{f}' must be a non-empty string")
            ok = False

    if not isinstance(data.get("state"), str) or len(data.get("state", "").strip()) != 2:
        error(f"{path}: 'state' must be a 2-letter code")
        ok = False

    ok = validate_point_list(data.get("boundary"), "boundary", path, min_points=3) and ok
    ok = validate_point_list(data.get("truckEntrances"), "truckEntrances", path, require_label=True) and ok
    ok = validate_point_list(data.get("truckExits"), "truckExits", path, require_label=True) and ok
    ok = validate_point_list(data.get("docks"), "docks", path, require_name=True) and ok
    ok = validate_point_list(data.get("navigationPath"), "navigationPath", path, min_points=0) and ok

    return ok

def main() -> None:
    all_entries: list[dict] = []
    ok = True

    for json_file in sorted(LOCATIONS_DIR.rglob("*.json")):
        print(f"Validating {json_file.relative_to(ROOT)}...")
        data = load_json(json_file)
        if data is None:
            ok = False
            continue
        if not validate_detail_file(json_file, data):
            ok = False
            continue

        rel_path = json_file.relative_to(ROOT).as_posix()
        entry = {
            "name": data["name"],
            "address": data["address"],
            "city": data["city"],
            "state": data["state"],
            "zip": data["zip"],
            "category": data["category"],
            "filePath": rel_path,
        }
        all_entries.append(entry)

    if not ok:
        print("Validation failed — masterlist.json was NOT updated.", file=sys.stderr)
        sys.exit(1)

    # Stable sort
    all_entries.sort(key=lambda x: x["name"])

    master_data = {"locations": all_entries}
    with MASTERLIST_PATH.open("w", encoding="utf-8") as handle:
        json.dump(master_data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    print(f"✅ Generated masterlist.json with {len(all_entries)} locations.")


if __name__ == "__main__":
    main()