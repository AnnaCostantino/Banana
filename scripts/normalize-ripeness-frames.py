#!/usr/bin/env python3
"""Slice ripeness frames: crop outside black sheet frame only; preserve full banana art."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

CELL_W, CELL_H = 1375, 739
COLS = 4
FRAME_COUNT = 31
# Pixels inside the printed black rectangle (past the stroke, not into the fruit).
FRAME_INSET = 8
PAPER_THR = 200


def cell_array(sheet: Image.Image, idx: int) -> np.ndarray:
    row, col = divmod(idx, COLS)
    box = (col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H)
    return np.array(sheet.crop(box).convert("RGBA"))


def _is_horizontal_frame_line(black: np.ndarray, y: int, width: int) -> bool:
    row = black[y]
    if row.mean() < 0.75:
        return False
    xs = np.where(row)[0]
    return xs.size >= int(width * 0.62)


def find_frame_bounds(rgb: np.ndarray) -> tuple[int, int, int, int]:
    """Locate the printed black cell frame near the sheet gutters (not bruise ink)."""
    h, w = rgb.shape[:2]
    black = (rgb[..., 0] < 55) & (rgb[..., 1] < 55) & (rgb[..., 2] < 55)

    top = None
    for y in range(0, min(170, h)):
        if _is_horizontal_frame_line(black, y, w):
            y2 = y
            while y2 + 1 < h and _is_horizontal_frame_line(black, y2 + 1, w):
                y2 += 1
            top = y2  # bottom edge of the top border band
            break

    bottom = None
    for y in range(h - 1, max(h - 170, -1), -1):
        if _is_horizontal_frame_line(black, y, w):
            y2 = y
            while y2 - 1 >= 0 and _is_horizontal_frame_line(black, y2 - 1, w):
                y2 -= 1
            bottom = y2  # top edge of the bottom border band
            break

    left, right = 116, 1348
    if top is not None:
        xs = np.where(black[top])[0]
        if xs.size:
            left, right = int(xs[0]), int(xs[-1])
    if bottom is not None:
        xs = np.where(black[bottom])[0]
        if xs.size:
            left = max(left, int(xs[0]))
            right = min(right, int(xs[-1]))

    ft, fb, fl, fr = 116, 722, 116, 1348
    top = top if top is not None else ft
    bottom = bottom if bottom is not None else fb
    left = max(fl, left)
    right = min(fr, right)
    return top, bottom, left, right


def crop_inside_frame(arr: np.ndarray, outer: tuple[int, int, int, int]) -> np.ndarray:
    top, bottom, left, right = outer
    top += FRAME_INSET
    bottom -= FRAME_INSET
    left += FRAME_INSET
    right -= FRAME_INSET
    if bottom <= top or right <= left:
        raise ValueError(f"Invalid crop after inset: {top=} {bottom=} {left=} {right=}")
    return arr[top : bottom + 1, left : right + 1].copy()


def trim_edge_frame_rows(arr: np.ndarray, max_rows: int = 8) -> np.ndarray:
    """Drop full-width black frame strokes on the crop rim only (not banana flesh)."""
    out = arr.copy()
    h, w = out.shape[:2]
    dark = (out[..., :3].max(axis=2) < 55) & (out[..., 3] > 0)

    removed = 0
    while removed < max_rows:
        row = dark[removed]
        if row.mean() < 0.72 or out[removed, :, 3].mean() < 0.55:
            break
        out[removed, row, 3] = 0
        removed += 1

    removed = 0
    while removed < max_rows:
        y = h - 1 - removed
        row = dark[y]
        if row.mean() < 0.72 or out[y, :, 3].mean() < 0.55:
            break
        out[y, row, 3] = 0
        removed += 1
    return out


def clear_paper(arr: np.ndarray) -> np.ndarray:
    """Make sheet paper transparent; keep all halftone banana ink."""
    out = arr.copy()
    rgb = out[..., :3]
    paper = (rgb[..., 0] >= PAPER_THR) & (rgb[..., 1] >= PAPER_THR) & (rgb[..., 2] >= PAPER_THR)
    out[paper, 3] = 0
    return out


def registration_point(arr: np.ndarray) -> tuple[float, float]:
    rgb = arr[..., :3]
    lum = rgb.max(axis=2)
    alpha = arr[..., 3] > 8
    yellow = (
        (rgb[..., 0] > 70)
        & (rgb[..., 1] > 70)
        & (rgb[..., 2] < rgb[..., 0])
        & alpha
    )
    mask = yellow if yellow.sum() > 500 else (lum > 50) & alpha
    ys, xs = np.where(mask)
    if xs.size == 0:
        ys, xs = np.where(alpha)
    return float(xs.mean()), float(ys.mean())


def paste_aligned(
    crop: np.ndarray, ax: float, ay: float, ref_x: float, ref_y: float, canvas_w: int, canvas_h: int, pad: int
) -> np.ndarray:
    px = int(round(pad + (ref_x - ax)))
    py = int(round(pad + (ref_y - ay)))
    canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
    h, w = crop.shape[:2]
    x0 = max(0, px)
    y0 = max(0, py)
    x1 = min(canvas_w, px + w)
    y1 = min(canvas_h, py + h)
    sx0, sy0 = x0 - px, y0 - py
    canvas[y0:y1, x0:x1] = crop[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
    return canvas


def process_frames(sheet_path: Path, out_dir: Path) -> dict[str, float | int | tuple[float, float]]:
    sheet = Image.open(sheet_path)
    crops: list[np.ndarray] = []
    anchors: list[tuple[float, float]] = []

    for i in range(FRAME_COUNT):
        arr = cell_array(sheet, i)
        outer = find_frame_bounds(arr[..., :3])
        crop = crop_inside_frame(arr, outer)
        crop = clear_paper(crop)
        crop = trim_edge_frame_rows(crop)
        crops.append(crop)
        anchors.append(registration_point(crop))

    ref_x, ref_y = anchors[0]
    pad = 8
    max_w = max(c.shape[1] for c in crops)
    max_h = max(c.shape[0] for c in crops)
    canvas_w = max_w + pad * 2
    canvas_h = max_h + pad * 2

    out_dir.mkdir(parents=True, exist_ok=True)
    for i, crop in enumerate(crops):
        canvas = paste_aligned(crop, *anchors[i], ref_x, ref_y, canvas_w, canvas_h, pad)
        Image.fromarray(canvas).save(out_dir / f"banana-{i:02d}.png", optimize=True)

    return {
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "frame_inset": FRAME_INSET,
        "anchor": (ref_x, ref_y),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    meta = process_frames(args.sheet, args.out)
    print(meta)


if __name__ == "__main__":
    main()