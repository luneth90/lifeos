#!/usr/bin/env python3
"""按 PDF point 区域原子生成局部 PNG，并输出机器可读结果。"""

from __future__ import annotations

import argparse
import sys
import hashlib
import json
import math
import tempfile
from pathlib import Path
from typing import Dict, Optional, Sequence, Tuple, Union

import fitz
# Windows 控制台默认代码页（cp1252/GBK）无法输出中文，强制 stdout 使用 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


BBox = Tuple[float, float, float, float]
Number = Union[int, float]


class CropPdfError(Exception):
    """用于向调用方返回稳定错误码。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class JsonArgumentParser(argparse.ArgumentParser):
    """将 argparse 错误统一送入 JSON 错误出口。"""

    def error(self, message: str) -> None:
        raise CropPdfError("INVALID_ARGUMENT", message)


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = JsonArgumentParser(description="按 PDF point 边界裁剪指定物理页。")
    parser.add_argument("pdf_path", help="源 PDF 路径")
    parser.add_argument("page", type=int, help="从 1 开始的物理 PDF 页码")
    parser.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        required=True,
        metavar=("X0", "Y0", "X1", "Y1"),
        help="PDF point 坐标，顺序为 x0 y0 x1 y1",
    )
    parser.add_argument(
        "--padding",
        type=float,
        default=0,
        help="区域四周留白，单位为 PDF point，范围 0..144",
    )
    parser.add_argument("--dpi", type=int, default=300, help="渲染 DPI，范围 72..600")
    parser.add_argument("--output", required=True, help="目标 PNG 路径")
    return parser.parse_args(argv)


def resolve_pdf_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    candidate = candidate.resolve()
    if not candidate.is_file():
        raise CropPdfError("PDF_NOT_FOUND", f"找不到 PDF 文件：{raw_path}")
    if candidate.suffix.lower() != ".pdf":
        raise CropPdfError("INVALID_PDF", "源文件必须使用 .pdf 后缀。")
    return candidate


def resolve_output_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.suffix.lower() != ".png":
        raise CropPdfError("INVALID_OUTPUT", "--output 必须使用 .png 后缀。")
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    return candidate.resolve()


def validate_padding(value: float) -> float:
    if not math.isfinite(value) or not 0 <= value <= 144:
        raise CropPdfError("INVALID_PADDING", "--padding 必须是 0 到 144 的有限数值。")
    return value


def validate_dpi(value: int) -> int:
    if not 72 <= value <= 600:
        raise CropPdfError("INVALID_DPI", "--dpi 必须是 72 到 600 的整数。")
    return value


def resolve_page(document: fitz.Document, physical_page: int) -> fitz.Page:
    if physical_page < 1 or physical_page > document.page_count:
        raise CropPdfError(
            "PAGE_OUT_OF_RANGE",
            f"物理页码必须位于 1 到 {document.page_count} 之间。",
        )
    return document[physical_page - 1]


def resolve_bbox(raw_bbox: Sequence[float]) -> BBox:
    if len(raw_bbox) != 4 or not all(math.isfinite(value) for value in raw_bbox):
        raise CropPdfError("INVALID_BBOX", "--bbox 必须包含四个有限数值。")
    x0, y0, x1, y1 = (float(value) for value in raw_bbox)
    if not x0 < x1 or not y0 < y1:
        raise CropPdfError("INVALID_BBOX", "--bbox 必须满足 x0 < x1 且 y0 < y1。")
    return (x0, y0, x1, y1)


def padded_bbox(page: fitz.Page, requested_bbox: BBox, padding: float) -> BBox:
    requested = fitz.Rect(*requested_bbox)
    if (requested & page.rect).is_empty:
        raise CropPdfError("INVALID_BBOX", "--bbox 必须与目标页面相交。")

    padded = fitz.Rect(
        requested.x0 - padding,
        requested.y0 - padding,
        requested.x1 + padding,
        requested.y1 + padding,
    )
    effective = padded & page.rect
    if not effective.is_valid or effective.is_empty:
        raise CropPdfError("INVALID_BBOX", "裁剪区域在页面边界内为空。")
    return (
        float(effective.x0),
        float(effective.y0),
        float(effective.x1),
        float(effective.y1),
    )


def render_region(page: fitz.Page, bbox: BBox, dpi: int) -> fitz.Pixmap:
    try:
        pixmap = page.get_pixmap(clip=fitz.Rect(*bbox), dpi=dpi, alpha=False)
    except Exception as exc:
        raise CropPdfError("RENDER_FAILED", f"PDF 区域渲染失败：{exc}") from exc
    if pixmap.width <= 0 or pixmap.height <= 0:
        raise CropPdfError("RENDER_FAILED", "PDF 区域渲染结果为空。")
    return pixmap


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_png_atomically(pixmap: fitz.Pixmap, output_path: Path) -> str:
    temporary_path: Optional[Path] = None
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=output_path.parent,
            prefix=".lifeos-crop-",
            suffix=".png",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        pixmap.save(str(temporary_path))
        digest = file_sha256(temporary_path)
        temporary_path.replace(output_path)
        temporary_path = None
        return digest
    except (OSError, RuntimeError, ValueError) as exc:
        raise CropPdfError("WRITE_FAILED", f"PNG 原子写入失败：{exc}") from exc
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def bbox_payload(bbox: BBox) -> Dict[str, Number]:
    return {"x0": bbox[0], "y0": bbox[1], "x1": bbox[2], "y1": bbox[3]}


def main(argv: Optional[Sequence[str]] = None) -> int:
    try:
        args = parse_args(argv)
        pdf_path = resolve_pdf_path(args.pdf_path)
        output_path = resolve_output_path(args.output)
        padding = validate_padding(args.padding)
        dpi = validate_dpi(args.dpi)

        try:
            document = fitz.open(str(pdf_path))
        except Exception as exc:
            raise CropPdfError("PDF_OPEN_FAILED", f"无法打开 PDF：{exc}") from exc

        with document:
            page = resolve_page(document, args.page)
            requested_bbox = resolve_bbox(args.bbox)
            effective_bbox = padded_bbox(page, requested_bbox, padding)
            pixmap = render_region(page, effective_bbox, dpi)
            digest = write_png_atomically(pixmap, output_path)

        payload = {
            "ok": True,
            "page": args.page,
            "requested_bbox": bbox_payload(requested_bbox),
            "effective_bbox": bbox_payload(effective_bbox),
            "padding": padding,
            "dpi": dpi,
            "width": pixmap.width,
            "height": pixmap.height,
            "sha256": digest,
            "output": str(output_path),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except CropPdfError as exc:
        payload = {"ok": False, "error": {"code": exc.code, "message": str(exc)}}
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
        return 2
    except Exception as exc:  # pragma: no cover
        payload = {
            "ok": False,
            "error": {"code": "UNEXPECTED_ERROR", "message": str(exc)},
        }
        print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
