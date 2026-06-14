#!/usr/bin/env python3
"""Validate MapBooks location JSON files and masterlist references."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTERLIST_PATH = ROOT / "masterlist.json"
LOCATIONS_DIR = ROOT / "Locations"

VALID_CATEGORIES = {"Warehouse", "Store", "Terminal", "Other"}
REQUIRED_MASTER_FIELDS = ("name", "address", "city", "state", "zip", "category", "filePath")
REQUIRED_DETAIL_FIELDS = ("name", "latitude", "longitude", "notes")


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
        if require_name and isinstance(item.get("notes"), str) is False and "notes" in item:
            error(f"{file_path}: {label} 'notes' must be a string when provided")
            ok = False
    return ok


def load_json(path: Path) -> object | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        error(f"{path}: invalid JSON ({exc})")
        return None
    except OSError as exc:
        error(f"{path}: unable to read file ({exc})")
        return None


def normalize_path(path_value: str) -> str:
    return path_value.replace("\\", "/")


def validate_detail_file(path: Path, expected_name: str | None = None) -> bool:
    data = load_json(path)
    if data is None:
        return False
    if not isinstance(data, dict):
        error(f"{path}: detail file must be a JSON object")
        return False

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
    elif expected_name and data["name"] != expected_name:
        error(
            f"{path}: detail name '{data['name']}' does not match "
            f"masterlist name '{expected_name}'"
        )
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

    ok = validate_point_list(data.get("boundary"), "boundary", path, min_points=3) and ok
    ok = validate_point_list(
        data.get("truckEntrances"), "truckEntrances", path, require_label=True
    ) and ok
    ok = validate_point_list(data.get("truckExits"), "truckExits", path, require_label=True) and ok
    ok = validate_point_list(data.get("docks"), "docks", path, require_name=True) and ok
    ok = validate_point_list(
        data.get("navigationPath"), "navigationPath", path, min_points=2
    ) and ok

    return ok


def validate_masterlist() -> bool:
    data = load_json(MASTERLIST_PATH)
    if data is None:
        return False
    if not isinstance(data, dict):
        error(f"{MASTERLIST_PATH}: must be a JSON object")
        return False
    if "locations" not in data:
        error(f"{MASTERLIST_PATH}: missing 'locations' array")
        return False
    if not isinstance(data["locations"], list):
        error(f"{MASTERLIST_PATH}: 'locations' must be an array")
        return False

    ok = True
    seen_paths: set[str] = set()
    seen_names: set[str] = set()
    referenced_paths: set[str] = set()

    for index, entry in enumerate(data["locations"]):
        label = f"masterlist.json locations[{index}]"
        if not isinstance(entry, dict):
            error(f"{label}: entry must be an object")
            ok = False
            continue

        for field in REQUIRED_MASTER_FIELDS:
            if field not in entry:
                error(f"{label}: missing required field '{field}'")
                ok = False

        if not ok:
            continue

        name = entry["name"]
        if not isinstance(name, str) or not name.strip():
            error(f"{label}: 'name' must be a non-empty string")
            ok = False
        elif name in seen_names:
            error(f"{label}: duplicate location name '{name}'")
            ok = False
        else:
            seen_names.add(name)

        category = entry["category"]
        if category not in VALID_CATEGORIES:
            error(f"{label}: invalid category '{category}'")
            ok = False

        state = entry["state"]
        if not isinstance(state, str) or len(state.strip()) != 2:
            error(f"{label}: 'state' must be a 2-letter code")
            ok = False

        for field in ("address", "city", "zip", "filePath"):
            if not isinstance(entry[field], str) or not entry[field].strip():
                error(f"{label}: '{field}' must be a non-empty string")
                ok = False

        file_path_value = normalize_path(entry["filePath"])
        if ".." in file_path_value.split("/"):
            error(f"{label}: filePath must not contain parent directory segments")
            ok = False
        if not file_path_value.startswith("Locations/"):
            error(f"{label}: filePath must start with 'Locations/'")
            ok = False
        if not file_path_value.endswith(".json"):
            error(f"{label}: filePath must end with '.json'")
            ok = False
        if file_path_value in seen_paths:
            error(f"{label}: duplicate filePath '{file_path_value}'")
            ok = False
        else:
            seen_paths.add(file_path_value)

        detail_path = ROOT / Path(file_path_value)
        if not detail_path.is_file():
            error(f"{label}: filePath does not exist: {file_path_value}")
            ok = False
        else:
            referenced_paths.add(file_path_value)
            if not validate_detail_file(detail_path, expected_name=name):
                ok = False

    if LOCATIONS_DIR.is_dir():
        for detail_file in LOCATIONS_DIR.rglob("*.json"):
            relative = normalize_path(detail_file.relative_to(ROOT).as_posix())
            if relative not in referenced_paths:
                error(f"Orphan location file not listed in masterlist.json: {relative}")
                ok = False
    else:
        error("Locations/ directory is missing")
        ok = False

    return ok


def main() -> int:
    print("Validating MapBooks location data...")
    if validate_masterlist():
        print("All location JSON files and masterlist references are valid.")
        return 0

    error("Validation failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())