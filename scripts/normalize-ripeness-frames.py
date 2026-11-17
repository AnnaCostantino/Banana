#!/usr/bin/env python3
"""Slice the borderless ripeness sheet into pixel-locked aligned frames."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

COLS = 4
ROW_COUNT = 8
FRAME_COUNT = 31
CELL_W = 1375
ROW_H = 739
PAPER_THR = 200
CANVAS_PAD = 8


def sheet_size(sheet: Image.Image) -> tuple[int, int]:
    return sheet.size[0], sheet.size[1]


def cell_box(idx: int, sheet_w: int, sheet_h: int) -> tuple[int, int, int, int]:
    row, col = divmod(idx, COLS)
    x0 = col * CELL_W
    x1 = x0 + CELL_W
    y0 = row * ROW_H
    y1 = sheet_h if row == ROW_COUNT - 1 else y0 + ROW_H
    return x0, y0, x1, y1


def cell_array(sheet: Image.Image, idx: int) -> np.ndarray:
    w, h = sheet_size(sheet)
    return np.array(sheet.crop(cell_box(idx, w, h)).convert("RGBA"))


def clear_paper(arr: np.ndarray) -> np.ndarray:
    out = arr.copy()
    rgb = out[..., :3]
    paper = (rgb[..., 0] >= PAPER_THR) & (rgb[..., 1] >= PAPER_THR) & (rgb[..., 2] >= PAPER_THR)
    out[paper, 3] = 0
    return out


def fruit_mask(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    yellow = (
        (rgb[..., 0] > 70)
        & (rgb[..., 1] > 70)
        & (rgb[..., 2] < rgb[..., 0])
        & alpha
    )
    dark = alpha & (rgb.max(axis=2) < 55)
    return yellow | dark


def fruit_metrics(arr: np.ndarray) -> dict[str, float | int]:
    rgb = arr[..., :3]
    alpha = arr[..., 3] > 8
    mask = fruit_mask(rgb, alpha)
    ys, xs = np.where(mask)
    if xs.size == 0:
        ys, xs = np.where(alpha)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    return {
        "cx": float(xs.mean()),
        "cy": float(ys.mean()),
        "x0": x0,
        "y0": y0,
        "x1": x1,
        "y1": y1,
    }


def compose_canvas(crop: np.ndarray, px: int, py: int, cw: int, ch: int) -> np.ndarray:
    canvas = np.zeros((ch, cw, 4), dtype=np.uint8)
    h, w = crop.shape[:2]
    x0 = max(0, px)
    y0 = max(0, py)
    x1 = min(cw, px + w)
    y1 = min(ch, py + h)
    if x1 <= x0 or y1 <= y0:
        return canvas
    sx0, sy0 = x0 - px, y0 - py
    canvas[y0:y1, x0:x1] = crop[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
    return canvas


def process_frames(sheet_path: Path, out_dir: Path, *, audit: bool = False) -> dict:
    sheet = Image.open(sheet_path)
    sheet_w, sheet_h = sheet_size(sheet)
    if sheet_w != COLS * CELL_W:
        raise ValueError(f"Expected sheet width {COLS * CELL_W}, got {sheet_w}")

    cells = [clear_paper(cell_array(sheet, i)) for i in range(FRAME_COUNT)]
    ref0 = fruit_metrics(cells[0])
    anchor_tl = (int(ref0["x0"]), int(ref0["y0"]))

    rough_places: list[tuple[int, int, int, int]] = []
    for crop in cells:
        m = fruit_metrics(crop)
        px = CANVAS_PAD + anchor_tl[0] - int(m["x0"])
        py = CANVAS_PAD + anchor_tl[1] - int(m["y0"])
        h, w = crop.shape[:2]
        rough_places.append((px, py, w, h))

    min_px = min(px for px, _, _, _ in rough_places)
    min_py = min(py for _, py, _, _ in rough_places)
    max_rx = max(px + w for px, _, w, _ in rough_places)
    max_by = max(py + h for _, py, _, h in rough_places)
    canvas_w = max_rx - min_px + CANVAS_PAD
    canvas_h = max_by - min_py + CANVAS_PAD

    target_tl = (
        CANVAS_PAD + anchor_tl[0] - min_px + CANVAS_PAD,
        CANVAS_PAD + anchor_tl[1] - min_py + CANVAS_PAD,
    )
    ref_canvas = compose_canvas(
        cells[0],
        rough_places[0][0] - min_px + CANVAS_PAD,
        rough_places[0][1] - min_py + CANVAS_PAD,
        canvas_w,
        canvas_h,
    )
    ref_cm = fruit_metrics(ref_canvas)
    target_cx, target_cy = ref_cm["cx"], ref_cm["cy"]
    target_tl = (int(ref_cm["x0"]), int(ref_cm["y0"]))

    drift_bbox: list[tuple[int, int, int]] = []
    drift_centroid: list[tuple[int, float, float]] = []
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, (crop, (px, py, _, _)) in enumerate(zip(cells, rough_places, strict=True)):
        sx = px - min_px + CANVAS_PAD
        sy = py - min_py + CANVAS_PAD
        canvas = compose_canvas(crop, sx, sy, canvas_w, canvas_h)
        Image.fromarray(canvas).save(out_dir / f"banana-{i:02d}.png", optimize=True)
        cm = fruit_metrics(canvas)
        drift_bbox.append((i, int(cm["x0"]) - target_tl[0], int(cm["y0"]) - target_tl[1]))
        drift_centroid.append((i, cm["cx"] - target_cx, cm["cy"] - target_cy))

    meta: dict = {
        "sheet": str(sheet_path),
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "fruit_bbox_tl": target_tl,
        "fruit_centroid": (target_cx, target_cy),
    }
    if audit:
        meta["bbox_tl_drift"] = drift_bbox
        meta["centroid_drift"] = drift_centroid
        meta["max_bbox_drift"] = max((abs(x) + abs(y) for _, x, y in drift_bbox), default=0)
        meta["max_centroid_drift"] = max((abs(x) + abs(y) for _, x, y in drift_centroid), default=0.0)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sheet",
        type=Path,
        default=Path(
            "/cursor/stores/bc-fd2c08b6-7567-45b4-aec8-8dc5ed326e0e/media/refs/"
            "banana-ripeness-sheet-no-border.png"
        ),
    )
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "frames")
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    if not args.sheet.is_file():
        raise SystemExit(f"Sheet not found: {args.sheet}")
    print(process_frames(args.sheet, args.out, audit=args.audit))


if __name__ == "__main__":
    main()