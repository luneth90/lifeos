#!/usr/bin/env python3
"""读取 PDF 指定页码或章节，并输出结构化 JSON 中间结果。"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import fitz


MAX_DEFAULT_PAGES = 50


@dataclass
class ChapterMatch:
    level: int
    title: str
    start_page: int
    end_page: int


class ReadPdfError(Exception):
    """用于向 CLI 返回可读错误信息。"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
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


def resolve_pdf_path(raw_path: str, cwd: Path) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = (cwd / candidate).resolve()
    if not candidate.exists():
        raise ReadPdfError(f"找不到 PDF 文件：{raw_path}")
    if candidate.suffix.lower() != ".pdf":
        raise ReadPdfError(f"目标文件不是 PDF：{candidate}")
    return candidate


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
            raise ReadPdfError(f"非法页码范围：{token}")
        start = int(start_str)
        end = int(end_str)
        if start > end:
            raise ReadPdfError(f"页码范围起点大于终点：{token}")
        return validate_pages(list(range(start, end + 1)), page_count)
    if not token.isdigit():
        raise ReadPdfError(f"非法页码：{token}")
    return validate_pages([int(token)], page_count)


def validate_pages(pages: Sequence[int], page_count: int) -> List[int]:
    invalid_pages = [page for page in pages if page < 1 or page > page_count]
    if invalid_pages:
        raise ReadPdfError(
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
        raise ReadPdfError("PDF 没有目录信息，无法按章节匹配。可改用页码范围。")

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
            "未找到匹配章节。你可以先用 --list-toc 查看目录，或参考这些条目：\n"
            + json.dumps(preview, ensure_ascii=False, indent=2)
        )
    if len(matches) > 1:
        candidates = [
            {"level": level, "title": title, "start_page": start_page, "end_page": end_page}
            for level, title, start_page, end_page in matches[:10]
        ]
        raise ReadPdfError(
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


def extract_text(doc: fitz.Document, pages: Sequence[int]) -> Tuple[Dict[str, str], List[int]]:
    full_text: Dict[str, str] = {}
    missing_text_pages: List[int] = []
    for page_number in pages:
        text = doc[page_number - 1].get_text("text")
        full_text[str(page_number)] = text
        if not text.strip():
            missing_text_pages.append(page_number)
    return full_text, missing_text_pages


def build_output_path(raw_output: Optional[str]) -> Path:
    if raw_output:
        output_path = Path(raw_output)
        if not output_path.is_absolute():
            output_path = (Path.cwd() / output_path).resolve()
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output_path = Path(f"/tmp/read-pdf-{timestamp}.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    return output_path


def build_result(
    pdf_input: str,
    resolved_pdf_path: Path,
    pages: Sequence[int],
    full_text: Dict[str, str],
    images: Sequence[Dict[str, Any]],
    missing_text_pages: Sequence[int],
    target: str,
    doc: fitz.Document,
    chapter_match: Optional[ChapterMatch],
) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "source": pdf_input,
        "resolved_path": str(resolved_pdf_path),
        "target": target,
        "page_count": doc.page_count,
        "pages": list(pages),
        "full_text": full_text,
        "images": list(images),
        "charts": [],
        "formulas": [],
        "tables": [],
        "text_layer_missing_pages": list(missing_text_pages),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }
    if chapter_match:
        result["mode"] = "chapter"
        result["chapter"] = {
            "level": chapter_match.level,
            "title": chapter_match.title,
            "start_page": chapter_match.start_page,
            "end_page": chapter_match.end_page,
        }
    else:
        result["mode"] = "pages"
    return result


def ensure_page_limit(pages: Sequence[int], max_pages: int, force_large_range: bool) -> None:
    if len(pages) <= max_pages or force_large_range:
        return
    raise ReadPdfError(
        f"本次命中 {len(pages)} 页，超过限制 {max_pages} 页。"
        "建议拆分批次，或显式传入 --force-large-range。"
    )


def main() -> int:
    args = parse_args()
    if not args.target and not args.list_toc:
        print("错误：缺少 target。请提供页码范围、单页、逗号列表，或章节名。", file=sys.stderr)
        return 2

    try:
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
            full_text, missing_text_pages = extract_text(doc, pages)

            images: List[Dict[str, Any]] = []
            if not args.skip_render:
                images_dir = Path(args.images_dir).resolve() if args.images_dir else None
                _, images = render_pages(doc, pages, args.dpi, images_dir)

            result = build_result(
                pdf_input=args.pdf_path,
                resolved_pdf_path=resolved_pdf_path,
                pages=pages,
                full_text=full_text,
                images=images,
                missing_text_pages=missing_text_pages,
                target=args.target,
                doc=doc,
                chapter_match=chapter_match,
            )

        output_path = build_output_path(args.output)
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print(f"已输出 JSON：{output_path}")
        print(
            "摘要："
            f"共处理 {len(result['pages'])} 页，"
            f"渲染 {len(result['images'])} 张图片，"
            f"缺少文字层页数 {len(result['text_layer_missing_pages'])}。"
        )
        return 0
    except ReadPdfError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # pragma: no cover
        print(f"未预期错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
