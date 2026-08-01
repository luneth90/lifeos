#!/usr/bin/env python3
"""读取 PDF 指定页码或章节，并输出结构化 JSON 中间结果。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import fitz


MAX_DEFAULT_PAGES = 50
ALLOWED_FORMAT_CONTROLS = {"\u200c", "\u200d"}


@dataclass
class ChapterMatch:
    level: int
    title: str
    start_page: int
    end_page: int


class ReadPdfError(Exception):
    """用于向 CLI 返回机器可读的错误。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class JsonArgumentParser(argparse.ArgumentParser):
    """将 argparse 的用户输入错误交给统一 JSON 错误出口。"""

    def error(self, message: str) -> None:
        raise ReadPdfError("INVALID_ARGUMENT", message)


def parse_args() -> argparse.Namespace:
    parser = JsonArgumentParser(
        description="按页码范围或章节名提取 PDF 内容，并输出 JSON 文件。"
    )
    parser.add_argument("pdf_path", help="PDF 路径，支持 Vault 相对路径或绝对路径")
    parser.add_argument(
        "target",
        nargs="?",
        help="页码范围、单页、逗号列表，或章节名，例如 245-260 / 245 / 245,247-249 / 第3章",
    )
    parser.add_argument(
        "--output",
        help="输出 JSON 路径；默认写入 /tmp/read-pdf-时间戳.json",
    )
    parser.add_argument(
        "--source-label",
        help="提取包中的安全 Vault 相对来源标签；默认仅使用 PDF 文件名",
    )
    parser.add_argument(
        "--images-dir",
        help="页面 PNG 输出目录；默认写入临时目录",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="页面渲染 DPI，默认 300",
    )
    parser.add_argument(
        "--skip-render",
        action="store_true",
        help="只提取文字，不渲染页面 PNG",
    )
    parser.add_argument(
        "--list-toc",
        action="store_true",
        help="列出 PDF TOC 并退出",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=MAX_DEFAULT_PAGES,
        help=f"单次允许处理的最大页数，默认 {MAX_DEFAULT_PAGES}",
    )
    parser.add_argument(
        "--force-large-range",
        action="store_true",
        help="允许处理超过 --max-pages 的范围",
    )
    return parser.parse_args()


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip().lower()
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def unsafe_source_character(value: str, index: int) -> bool:
    character = value[index]
    category = unicodedata.category(character)
    if category in {"Cc", "Cs"}:
        return True
    if category != "Cf":
        return False
    if character not in ALLOWED_FORMAT_CONTROLS:
        return True
    if index == 0 or index == len(value) - 1:
        return True

    previous = value[index - 1]
    following = value[index + 1]
    return (
        previous in {"/", "\\"}
        or following in {"/", "\\"}
        or unicodedata.category(previous).startswith("C")
        or unicodedata.category(following).startswith("C")
    )


def resolve_pdf_path(raw_path: str, cwd: Path) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = (cwd / candidate).resolve()
    if not candidate.exists():
        raise ReadPdfError("PDF_NOT_FOUND", f"找不到 PDF 文件：{raw_path}")
    if candidate.suffix.lower() != ".pdf":
        raise ReadPdfError("INVALID_PDF_PATH", f"目标文件不是 PDF：{candidate}")
    return candidate


def normalize_source_label(raw_label: Optional[str], resolved_pdf_path: Path) -> str:
    label = resolved_pdf_path.name if raw_label is None else raw_label
    normalized = unicodedata.normalize("NFKC", label)
    segments = normalized.split("/")
    if (
        not normalized
        or normalized != normalized.strip()
        or normalized.startswith(("/", "~/"))
        or "\\" in normalized
        or ":" in normalized
        or any(not segment or segment in {".", ".."} for segment in segments)
        or any(unsafe_source_character(normalized, index) for index in range(len(normalized)))
    ):
        raise ReadPdfError(
            "INVALID_SOURCE_LABEL",
            "--source-label 必须是非空、安全的 Vault 相对标签，且不得包含绝对路径或上级目录。",
        )
    return normalized


def get_toc_entries(doc: fitz.Document) -> List[Tuple[int, str, int]]:
    toc = doc.get_toc(simple=True)
    return [(int(level), str(title), int(page)) for level, title, page in toc]


def dump_toc(doc: fitz.Document) -> None:
    toc = [
        {"level": level, "title": title, "page": page}
        for level, title, page in get_toc_entries(doc)
    ]
    print(json.dumps(toc, ensure_ascii=False, indent=2))


def parse_page_token(token: str, page_count: int) -> List[int]:
    token = token.strip()
    if not token:
        return []
    if "-" in token:
        start_str, end_str = token.split("-", 1)
        if not start_str.isdigit() or not end_str.isdigit():
            raise ReadPdfError("INVALID_PAGE_RANGE", f"非法页码范围：{token}")
        start = int(start_str)
        end = int(end_str)
        if start > end:
            raise ReadPdfError("INVALID_PAGE_RANGE", f"页码范围起点大于终点：{token}")
        return validate_pages(list(range(start, end + 1)), page_count)
    if not token.isdigit():
        raise ReadPdfError("INVALID_PAGE_RANGE", f"非法页码：{token}")
    return validate_pages([int(token)], page_count)


def validate_pages(pages: Sequence[int], page_count: int) -> List[int]:
    invalid_pages = [page for page in pages if page < 1 or page > page_count]
    if invalid_pages:
        raise ReadPdfError(
            "PAGE_OUT_OF_RANGE",
            f"页码超出范围：{invalid_pages}。PDF 总页数为 {page_count}。"
        )
    return list(pages)


def parse_page_spec(spec: str, page_count: int) -> Optional[List[int]]:
    compact = spec.replace(" ", "")
    if not compact or not re.fullmatch(r"[\d,\-]+", compact):
        return None
    pages: List[int] = []
    for token in compact.split(","):
        pages.extend(parse_page_token(token, page_count))
    return sorted(set(pages))


def resolve_chapter(doc: fitz.Document, query: str) -> ChapterMatch:
    toc_entries = get_toc_entries(doc)
    if not toc_entries:
        raise ReadPdfError("TOC_MISSING", "PDF 没有目录信息，无法按章节匹配。可改用页码范围。")

    normalized_query = normalize_text(query)
    exact_matches: List[Tuple[int, str, int, int]] = []
    fuzzy_matches: List[Tuple[int, str, int, int]] = []

    for index, (level, title, start_page) in enumerate(toc_entries):
        normalized_title = normalize_text(title)
        if not normalized_title:
            continue
        end_page = doc.page_count
        for next_level, _next_title, next_page in toc_entries[index + 1 :]:
            if next_level <= level:
                end_page = next_page - 1
                break
        entry = (level, title, start_page, end_page)
        if normalized_title == normalized_query:
            exact_matches.append(entry)
        elif normalized_query in normalized_title or normalized_title in normalized_query:
            fuzzy_matches.append(entry)

    matches = exact_matches or fuzzy_matches
    if not matches:
        preview = [
            {"level": level, "title": title, "page": page}
            for level, title, page in toc_entries[:20]
        ]
        raise ReadPdfError(
            "CHAPTER_NOT_FOUND",
            "未找到匹配章节。你可以先用 --list-toc 查看目录，或参考这些条目：\n"
            + json.dumps(preview, ensure_ascii=False, indent=2)
        )
    if len(matches) > 1:
        candidates = [
            {"level": level, "title": title, "start_page": start_page, "end_page": end_page}
            for level, title, start_page, end_page in matches[:10]
        ]
        raise ReadPdfError(
            "CHAPTER_AMBIGUOUS",
            "匹配到多个章节，请改用更精确的章节名：\n"
            + json.dumps(candidates, ensure_ascii=False, indent=2)
        )

    level, title, start_page, end_page = matches[0]
    return ChapterMatch(level=level, title=title, start_page=start_page, end_page=end_page)


def render_pages(
    doc: fitz.Document,
    pages: Sequence[int],
    dpi: int,
    images_dir: Optional[Path],
) -> Tuple[Path, List[Dict[str, Any]]]:
    target_dir = images_dir
    if target_dir is None:
        target_dir = Path(tempfile.mkdtemp(prefix="read-pdf-pages-"))
    else:
        target_dir.mkdir(parents=True, exist_ok=True)

    images: List[Dict[str, Any]] = []
    for page_number in pages:
        page = doc[page_number - 1]
        pix = page.get_pixmap(dpi=dpi)
        image_path = target_dir / f"page_{page_number}.png"
        pix.save(str(image_path))
        images.append({"page": page_number, "path": str(image_path)})
    return target_dir, images


def resolve_images_dir(output_path: Path, raw_images_dir: Optional[str]) -> Tuple[Path, bool]:
    """显式目录归用户所有；自动目录只能由本次调用创建和清理。"""
    if raw_images_dir:
        return Path(raw_images_dir).resolve(), False
    return Path(tempfile.mkdtemp(prefix=f"{output_path.stem}-images-", dir=str(output_path.parent))), True


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_metadata(resolved_pdf_path: Path, page_count: int, source_label: str) -> Dict[str, Any]:
    stat = resolved_pdf_path.stat()
    return {
        "path": source_label,
        "sha256": file_sha256(resolved_pdf_path),
        "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "page_count": page_count,
    }


def build_output_path(raw_output: Optional[str], source_hash: str) -> Path:
    if raw_output:
        output_path = Path(raw_output)
        if not output_path.is_absolute():
            output_path = (Path.cwd() / output_path).resolve()
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        output_path = Path(f"/tmp/read-pdf-{timestamp}-{source_hash[:8]}.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    return output_path


def vector_visual_anchor(page: fitz.Page) -> Optional[Tuple[float, float]]:
    """把有意义的矢量内容合并为一个页级视觉占位。

    单个标题条、平行分隔线、无填充页框和微小装饰不足以让页面降级；
    复杂路径、多个填充图形、至少三个二维框，或水平与垂直线组成的网格则交由视觉分析。
    """
    page_area = max(float(page.rect.width * page.rect.height), 1.0)
    complex_regions: List[Tuple[float, float, float, float]] = []
    filled_regions: List[Tuple[float, float, float, float]] = []
    box_regions: List[Tuple[float, float, float, float]] = []
    horizontal_lines: List[Tuple[float, float, float, float]] = []
    vertical_lines: List[Tuple[float, float, float, float]] = []

    for drawing in page.get_drawings():
        rectangle = drawing.get("rect")
        if rectangle is None:
            continue
        region = (
            float(rectangle.x0),
            float(rectangle.y0),
            float(rectangle.x1),
            float(rectangle.y1),
        )
        width = max(region[2] - region[0], 0.0)
        height = max(region[3] - region[1], 0.0)
        area_ratio = width * height / page_area
        items = drawing.get("items", [])
        item_count = len(items) if isinstance(items, (list, tuple)) else 0
        if 0.001 <= area_ratio <= 0.75:
            if item_count >= 3:
                complex_regions.append(region)
            elif drawing.get("fill") is not None:
                filled_regions.append(region)
            elif width >= 4 and height >= 4:
                box_regions.append(region)
        if height <= 2 and width >= 24:
            horizontal_lines.append(region)
        elif width <= 2 and height >= 24:
            vertical_lines.append(region)

    if complex_regions:
        selected_regions = complex_regions
    elif len(filled_regions) >= 2:
        selected_regions = filled_regions
    elif len(box_regions) >= 3:
        selected_regions = box_regions
    elif len(horizontal_lines) >= 2 and len(vertical_lines) >= 2:
        selected_regions = horizontal_lines + vertical_lines
    else:
        selected_regions = []

    if not selected_regions:
        return None
    return (
        min(region[1] for region in selected_regions),
        min(region[0] for region in selected_regions),
    )


def extract_blocks(page: fitz.Page) -> List[Dict[str, Any]]:
    """按页面阅读顺序公开文字与待视觉分析的图像区域。"""
    raw_blocks = page.get_text("dict").get("blocks", [])
    sortable: List[Tuple[float, float, str, str]] = []
    for raw in raw_blocks:
        bbox = raw.get("bbox", (0, 0, 0, 0))
        kind = raw.get("type")
        if kind == 0:
            content = "".join(
                span.get("text", "")
                for line in raw.get("lines", [])
                for span in line.get("spans", [])
            ).strip()
            if content:
                sortable.append((float(bbox[1]), float(bbox[0]), "text", content))
        elif kind == 1:
            sortable.append((float(bbox[1]), float(bbox[0]), "image", ""))

    vector_anchor = vector_visual_anchor(page)
    if vector_anchor is not None:
        sortable.append((vector_anchor[0], vector_anchor[1], "image", ""))
    sortable.sort(key=lambda item: (item[0], item[1]))
    return [
        {"kind": kind, "order": index, "content": content}
        for index, (_top, _left, kind, content) in enumerate(sortable, start=1)
    ]


def extract_printed_page_label(page: fitz.Page) -> Optional[str]:
    """只接受页脚中孤立且无歧义的页码文字，其他情况保持未知。"""
    candidates: List[str] = []
    footer_top = page.rect.height * 0.75
    for raw in page.get_text("dict").get("blocks", []):
        if raw.get("type") != 0 or raw.get("bbox", (0, 0, 0, 0))[1] < footer_top:
            continue
        content = "".join(
            span.get("text", "")
            for line in raw.get("lines", [])
            for span in line.get("spans", [])
        ).strip()
        if re.fullmatch(r"(?:\d+|[IVXLCDM]+)", content):
            candidates.append(content)
    unique = list(dict.fromkeys(candidates))
    return unique[0] if len(unique) == 1 else None


def extract_page(page: fitz.Page, pdf_page_index: int) -> Dict[str, Any]:
    try:
        blocks = extract_blocks(page)
        printed_page_label = extract_printed_page_label(page)
        has_text = any(block["kind"] == "text" for block in blocks)
        has_visual = any(block["kind"] == "image" for block in blocks)
        if not has_text:
            status, coverage, confidence, errors = "needs_ocr", 0, 0, ["TEXT_LAYER_MISSING"]
        elif has_visual:
            status, coverage, confidence, errors = "partial", 0.5, 0.8, ["VISUAL_CONTENT_PENDING"]
        else:
            status, coverage, confidence, errors = "complete", 1, 1, []
        return {
            "pdf_page_index": pdf_page_index,
            "printed_page_label": printed_page_label,
            "status": status,
            "coverage": coverage,
            "confidence": confidence,
            "errors": errors,
            "blocks": blocks,
        }
    except Exception as exc:  # pragma: no cover - defensive per-page isolation
        return {
            "pdf_page_index": pdf_page_index,
            "printed_page_label": None,
            "status": "failed",
            "coverage": 0,
            "confidence": 0,
            "errors": ["EXTRACTION_FAILED", type(exc).__name__],
            "blocks": [],
        }


def build_result(
    source: Dict[str, Any], pages: Sequence[int], extracted_pages: Sequence[Dict[str, Any]], images: Sequence[Dict[str, Any]]
) -> Dict[str, Any]:
    summary = {
        "complete_pages": sum(page["status"] == "complete" for page in extracted_pages),
        "needs_ocr_pages": sum(page["status"] == "needs_ocr" for page in extracted_pages),
        "partial_pages": sum(page["status"] == "partial" for page in extracted_pages),
        "failed_pages": sum(page["status"] == "failed" for page in extracted_pages),
    }
    result: Dict[str, Any] = {
        "schema_version": 1,
        "source": source,
        "extractor": {"name": "lifeos-read-pdf", "version": "1"},
        "requested_range": {"start": min(pages), "end": max(pages)},
        "requested_pages": list(pages),
        "pages": list(extracted_pages),
        "summary": summary,
    }
    if images:
        result["rendered_images"] = list(images)
    return result


def ensure_page_limit(pages: Sequence[int], max_pages: int, force_large_range: bool) -> None:
    if len(pages) <= max_pages or force_large_range:
        return
    raise ReadPdfError(
        "PAGE_LIMIT_EXCEEDED",
        f"本次命中 {len(pages)} 页，超过限制 {max_pages} 页。"
        "建议拆分批次，或显式传入 --force-large-range。"
    )


def main() -> int:
    generated_images_dir: Optional[Path] = None
    owns_generated_images_dir = False
    package_written = False
    try:
        args = parse_args()
        if not args.target and not args.list_toc:
            raise ReadPdfError("TARGET_REQUIRED", "缺少 target")
        resolved_pdf_path = resolve_pdf_path(args.pdf_path, Path.cwd())
        with fitz.open(str(resolved_pdf_path)) as doc:
            if args.list_toc:
                dump_toc(doc)
                return 0

            page_spec = parse_page_spec(args.target, doc.page_count)
            chapter_match: Optional[ChapterMatch] = None
            if page_spec is None:
                chapter_match = resolve_chapter(doc, args.target)
                pages = list(range(chapter_match.start_page, chapter_match.end_page + 1))
            else:
                pages = page_spec

            ensure_page_limit(pages, args.max_pages, args.force_large_range)
            source_label = normalize_source_label(args.source_label, resolved_pdf_path)
            source = source_metadata(resolved_pdf_path, doc.page_count, source_label)
            output_path = build_output_path(args.output, source["sha256"])
            extracted_pages = [extract_page(doc[page_number - 1], page_number) for page_number in pages]

            images: List[Dict[str, Any]] = []
            visual_pages = [
                page["pdf_page_index"]
                for page in extracted_pages
                if page["status"] in {"needs_ocr", "partial", "failed"}
                or any(block["kind"] == "image" for block in page["blocks"])
            ]
            if not args.skip_render and visual_pages:
                images_dir, owns_generated_images_dir = resolve_images_dir(output_path, args.images_dir)
                generated_images_dir = images_dir if owns_generated_images_dir else None
                _, images = render_pages(doc, visual_pages, args.dpi, images_dir)

            result = build_result(source, pages, extracted_pages, images)
            output_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            package_written = True

        print(f"已输出 JSON：{output_path}")
        print(
            "摘要："
            f"共处理 {len(result['pages'])} 页，"
            f"完整 {result['summary']['complete_pages']} 页，"
            f"待 OCR {result['summary']['needs_ocr_pages']} 页，"
            f"部分 {result['summary']['partial_pages']} 页，"
            f"失败 {result['summary']['failed_pages']} 页。"
        )
        return 0
    except ReadPdfError as exc:
        if generated_images_dir and owns_generated_images_dir and not package_written:
            shutil.rmtree(generated_images_dir, ignore_errors=True)
        print(json.dumps({"error": {"code": exc.code, "message": str(exc)}}, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:  # pragma: no cover
        if generated_images_dir and owns_generated_images_dir and not package_written:
            shutil.rmtree(generated_images_dir, ignore_errors=True)
        print(json.dumps({"error": {"code": "UNEXPECTED_ERROR", "message": str(exc)}}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
