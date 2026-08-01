#!/usr/bin/env python3
"""校验 LifeOS PDF 提取包的结构与跨字段完整性。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence


Diagnostic = Dict[str, str]
SUPPORTED_SCHEMA_KEYWORDS = {
    "$id",
    "$schema",
    "additionalProperties",
    "const",
    "description",
    "enum",
    "format",
    "items",
    "maximum",
    "minItems",
    "minLength",
    "minimum",
    "pattern",
    "properties",
    "required",
    "title",
    "type",
    "uniqueItems",
}


def add_diagnostic(diagnostics: List[Diagnostic], code: str, path: str) -> None:
    diagnostics.append({"code": code, "path": path})


def child_path(path: str, key: str) -> str:
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        return f"{path}.{key}"
    return f"{path}[{json.dumps(key, ensure_ascii=False)}]"


def matches_type(value: Any, expected: str) -> bool:
    if expected == "null":
        return value is None
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    return False


def json_equal(left: Any, right: Any) -> bool:
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    return left == right


def valid_date_time(value: str) -> bool:
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return False
    return parsed.tzinfo is not None


def validate_schema_value(
    value: Any,
    schema: Dict[str, Any],
    path: str,
    diagnostics: List[Diagnostic],
) -> None:
    if any(keyword not in SUPPORTED_SCHEMA_KEYWORDS for keyword in schema):
        add_diagnostic(diagnostics, "schema_unsupported_keyword", path)

    declared_type = schema.get("type")
    if declared_type is not None:
        expected_types = [declared_type] if isinstance(declared_type, str) else declared_type
        if not isinstance(expected_types, list) or not all(isinstance(item, str) for item in expected_types):
            add_diagnostic(diagnostics, "schema_definition", path)
            return
        if not any(matches_type(value, item) for item in expected_types):
            add_diagnostic(diagnostics, "schema_type", path)
            return

    if "const" in schema and not json_equal(value, schema["const"]):
        add_diagnostic(diagnostics, "schema_const", path)
    if "enum" in schema and not any(json_equal(value, candidate) for candidate in schema["enum"]):
        add_diagnostic(diagnostics, "schema_enum", path)

    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if isinstance(key, str) and key not in value:
                    add_diagnostic(diagnostics, "schema_required", child_path(path, key))

        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            add_diagnostic(diagnostics, "schema_definition", path)
            return
        for key, item in value.items():
            property_path = child_path(path, str(key))
            property_schema = properties.get(key)
            if isinstance(property_schema, dict):
                validate_schema_value(item, property_schema, property_path, diagnostics)
            elif schema.get("additionalProperties") is False:
                add_diagnostic(diagnostics, "schema_additional_property", property_path)

    if isinstance(value, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(value) < min_items:
            add_diagnostic(diagnostics, "schema_min_items", path)
        if schema.get("uniqueItems") is True:
            serialized = [json.dumps(item, ensure_ascii=False, sort_keys=True) for item in value]
            if len(serialized) != len(set(serialized)):
                add_diagnostic(diagnostics, "schema_unique_items", path)
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate_schema_value(item, item_schema, f"{path}[{index}]", diagnostics)

    if isinstance(value, str):
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(value) < min_length:
            add_diagnostic(diagnostics, "schema_min_length", path)
        pattern = schema.get("pattern")
        if isinstance(pattern, str):
            try:
                matches = re.search(pattern, value) is not None
            except re.error:
                add_diagnostic(diagnostics, "schema_definition", path)
            else:
                if not matches:
                    add_diagnostic(diagnostics, "schema_pattern", path)
        if schema.get("format") == "date-time" and not valid_date_time(value):
            add_diagnostic(diagnostics, "schema_format", path)

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            add_diagnostic(diagnostics, "schema_minimum", path)
        if isinstance(maximum, (int, float)) and value > maximum:
            add_diagnostic(diagnostics, "schema_maximum", path)


def integer_list(value: Any) -> Optional[List[int]]:
    if not isinstance(value, list):
        return None
    if not all(isinstance(item, int) and not isinstance(item, bool) for item in value):
        return None
    return value


def number_value(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def validate_page_semantics(page: Dict[str, Any], index: int, diagnostics: List[Diagnostic]) -> None:
    path = f"$.pages[{index}]"
    status = page.get("status")
    coverage = number_value(page.get("coverage"))
    errors = page.get("errors")
    blocks = page.get("blocks")

    if isinstance(blocks, list):
        orders = [block.get("order") for block in blocks if isinstance(block, dict)]
        if len(orders) == len(blocks) and orders != list(range(1, len(blocks) + 1)):
            add_diagnostic(diagnostics, "block_order_sequence", f"{path}.blocks")

    if status == "complete":
        if coverage != 1:
            add_diagnostic(diagnostics, "complete_coverage", f"{path}.coverage")
        if errors != []:
            add_diagnostic(diagnostics, "complete_errors", f"{path}.errors")
        if isinstance(blocks, list) and any(
            isinstance(block, dict) and block.get("kind") == "image" for block in blocks
        ):
            add_diagnostic(diagnostics, "complete_image_blocks", f"{path}.blocks")
        return

    if status not in {"needs_ocr", "partial", "failed"}:
        return
    if not isinstance(errors, list) or len(errors) == 0:
        add_diagnostic(diagnostics, "incomplete_errors", f"{path}.errors")
    if coverage is None or not 0 <= coverage < 1:
        add_diagnostic(diagnostics, "incomplete_coverage", f"{path}.coverage")
    if status == "needs_ocr" and coverage != 0:
        add_diagnostic(diagnostics, "needs_ocr_coverage", f"{path}.coverage")
    if status == "partial" and (coverage is None or not 0 < coverage < 1):
        add_diagnostic(diagnostics, "partial_coverage", f"{path}.coverage")
    if status == "failed" and coverage != 0:
        add_diagnostic(diagnostics, "failed_coverage", f"{path}.coverage")


def validate_semantics(package: Any, require_complete: bool) -> List[Diagnostic]:
    diagnostics: List[Diagnostic] = []
    if not isinstance(package, dict):
        return diagnostics

    requested_pages = integer_list(package.get("requested_pages"))
    if requested_pages is not None and any(
        current >= following for current, following in zip(requested_pages, requested_pages[1:])
    ):
        add_diagnostic(diagnostics, "requested_pages_order", "$.requested_pages")

    pages = package.get("pages")
    page_objects = pages if isinstance(pages, list) and all(isinstance(page, dict) for page in pages) else None
    if requested_pages is not None and page_objects is not None:
        page_indices = integer_list([page.get("pdf_page_index") for page in page_objects])
        if page_indices is not None and page_indices != requested_pages:
            add_diagnostic(diagnostics, "page_sequence_mismatch", "$.pages")

    requested_range = package.get("requested_range")
    if isinstance(requested_range, dict):
        start = requested_range.get("start")
        end = requested_range.get("end")
        if (
            isinstance(start, int)
            and not isinstance(start, bool)
            and isinstance(end, int)
            and not isinstance(end, bool)
        ):
            if start > end:
                add_diagnostic(diagnostics, "requested_range_order", "$.requested_range")
            if requested_pages and (start != requested_pages[0] or end != requested_pages[-1]):
                add_diagnostic(diagnostics, "requested_range_mismatch", "$.requested_range")

    source = package.get("source")
    if isinstance(source, dict) and requested_pages:
        page_count = source.get("page_count")
        if isinstance(page_count, int) and not isinstance(page_count, bool):
            if requested_pages[0] < 1 or requested_pages[-1] > page_count:
                add_diagnostic(diagnostics, "page_out_of_source", "$.requested_pages")

    if page_objects is not None:
        for index, page in enumerate(page_objects):
            validate_page_semantics(page, index, diagnostics)

        statuses = [page.get("status") for page in page_objects]
        if all(status in {"complete", "needs_ocr", "partial", "failed"} for status in statuses):
            expected_summary = {
                "complete_pages": statuses.count("complete"),
                "needs_ocr_pages": statuses.count("needs_ocr"),
                "partial_pages": statuses.count("partial"),
                "failed_pages": statuses.count("failed"),
            }
            if package.get("summary") != expected_summary:
                add_diagnostic(diagnostics, "summary_mismatch", "$.summary")
        if require_complete and any(status != "complete" for status in statuses):
            add_diagnostic(diagnostics, "package_incomplete", "$.pages")
    elif require_complete:
        add_diagnostic(diagnostics, "package_incomplete", "$.pages")

    return diagnostics


def unique_diagnostics(diagnostics: Iterable[Diagnostic]) -> List[Diagnostic]:
    keyed = {(item["path"], item["code"]): item for item in diagnostics}
    return [keyed[key] for key in sorted(keyed)]


def validate_package(package: Any, schema: Dict[str, Any], require_complete: bool = False) -> List[Diagnostic]:
    diagnostics: List[Diagnostic] = []
    validate_schema_value(package, schema, "$", diagnostics)
    diagnostics.extend(validate_semantics(package, require_complete))
    return unique_diagnostics(diagnostics)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    default_schema = Path(__file__).resolve().parents[3] / "schema" / "PDF_Extraction_Schema.json"
    parser = argparse.ArgumentParser(description="校验 LifeOS PDF 提取包")
    parser.add_argument("package_path", help="待校验的 JSON 提取包")
    parser.add_argument("--schema", default=str(default_schema), help="PDF 提取包 JSON Schema")
    parser.add_argument("--require-complete", action="store_true", help="要求所有请求页均为 complete")
    return parser.parse_args(argv)


def read_json(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        package = read_json(args.package_path)
        schema = read_json(args.schema)
    except (OSError, json.JSONDecodeError) as exc:
        payload = {"ok": False, "diagnostics": [{"code": "input_error", "path": "$"}]}
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
        return 2

    if not isinstance(schema, dict):
        payload = {"ok": False, "diagnostics": [{"code": "schema_definition", "path": "$"}]}
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
        return 2

    diagnostics = validate_package(package, schema, args.require_complete)
    payload = {"ok": not diagnostics, "diagnostics": diagnostics}
    stream = sys.stdout if not diagnostics else sys.stderr
    print(json.dumps(payload, ensure_ascii=False), file=stream)
    return 0 if not diagnostics else 1


if __name__ == "__main__":
    raise SystemExit(main())
