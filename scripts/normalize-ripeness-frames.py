#!/usr/bin/env python3
"""Slice ripeness frames: one shared crop per cell, fixed canvas, frame-0 registration."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

CELL_W, CELL_H = 1375, 739
COLS = 4
FRAME_COUNT = 31
# Inset past the printed black rectangle stroke (not into banana halftone).
FRAME_INSET = 8
# Fallback if frame-0 gutter detect fails.
REF_OUTER = (116, 722, 116, 1348)
PAPER_THR = 200
MARGIN_BAND = 14
CANVAS_PAD = 8


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
    """Printed black cell frame near gutters (frame-0 only at build time)."""
    h, w = rgb.shape[:2]
    black = (rgb[..., 0] < 55) & (rgb[..., 1] < 55) & (rgb[..., 2] < 55)

    top = None
    for y in range(0, min(170, h)):
        if _is_horizontal_frame_line(black, y, w):
            y2 = y
            while y2 + 1 < h and _is_horizontal_frame_line(black, y2 + 1, w):
                y2 += 1
            top = y2
            break

    bottom = None
    for y in range(h - 1, max(h - 170, -1), -1):
        if _is_horizontal_frame_line(black, y, w):
            y2 = y
            while y2 - 1 >= 0 and _is_horizontal_frame_line(black, y2 - 1, w):
                y2 -= 1
            bottom = y2
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

    ft, fb, fl, fr = REF_OUTER
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


def clear_paper(arr: np.ndarray) -> np.ndarray:
    out = arr.copy()
    rgb = out[..., :3]
    paper = (rgb[..., 0] >= PAPER_THR) & (rgb[..., 1] >= PAPER_THR) & (rgb[..., 2] >= PAPER_THR)
    out[paper, 3] = 0
    return out


def _yellow_mask(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    return (
        (rgb[..., 0] > 70)
        & (rgb[..., 1] > 70)
        & (rgb[..., 2] < rgb[..., 0])
        & alpha
    )


def clear_frame_margin_ink(arr: np.ndarray, band: int = MARGIN_BAND) -> np.ndarray:
    """Knock out sheet rule strokes in a fixed edge band; never touch fruit halftone."""
    out = arr.copy()
    h, w = out.shape[:2]
    rgb = out[..., :3]
    alpha = out[..., 3]
    lum = rgb.max(axis=2)
    ink = alpha > 8
    yellow = _yellow_mask(rgb, ink)
    dark = ink & (rgb[..., 0] < 55) & (rgb[..., 1] < 55) & (rgb[..., 2] < 55)
    halftone = ink & (lum > 48) & ~yellow

    for y in range(min(band, h)):
        if dark[y].mean() > 0.55:
            out[y, dark[y] & ~yellow[y] & ~halftone[y], 3] = 0
    for y in range(max(0, h - band), h):
        if dark[y].mean() > 0.55:
            out[y, dark[y] & ~yellow[y] & ~halftone[y], 3] = 0
    for x in range(min(band, w)):
        col = dark[:, x]
        if col.mean() > 0.35:
            out[col & ~yellow[:, x] & ~halftone[:, x], x, 3] = 0
    for x in range(max(0, w - band), w):
        col = dark[:, x]
        if col.mean() > 0.35:
            out[col & ~yellow[:, x] & ~halftone[:, x], x, 3] = 0
    return out


def trim_fullwidth_frame_rim(arr: np.ndarray, max_rows: int = 6) -> np.ndarray:
    """Remove only full-width black rim strokes on the crop edge (sheet frame, not flesh)."""
    out = arr.copy()
    h, w = out.shape[:2]
    dark = (out[..., :3].max(axis=2) < 55) & (out[..., 3] > 0)

    removed = 0
    while removed < max_rows:
        row = dark[removed]
        if row.mean() < 0.72:
            break
        out[removed, row, 3] = 0
        removed += 1

    removed = 0
    while removed < max_rows:
        y = h - 1 - removed
        row = dark[y]
        if row.mean() < 0.72:
            break
        out[y, row, 3] = 0
        removed += 1
    return out


def prepare_cell(arr: np.ndarray, outer: tuple[int, int, int, int]) -> np.ndarray:
    crop = crop_inside_frame(arr, outer)
    crop = clear_paper(crop)
    crop = trim_fullwidth_frame_rim(crop)
    crop = clear_frame_margin_ink(crop)
    return crop


def registration_point(arr: np.ndarray) -> tuple[float, float]:
    """Frame-0 anchor: yellow centroid when present, else opaque ink centroid."""
    rgb = arr[..., :3]
    lum = rgb.max(axis=2)
    alpha = arr[..., 3] > 8
    yellow = _yellow_mask(rgb, alpha)
    mask = yellow if yellow.sum() > 500 else (lum > 50) & alpha
    ys, xs = np.where(mask)
    if xs.size == 0:
        ys, xs = np.where(alpha)
    return float(xs.mean()), float(ys.mean())


def measure_registration(canvas: np.ndarray) -> tuple[float, float]:
    rgb = canvas[..., :3]
    alpha = canvas[..., 3] > 8
    yellow = _yellow_mask(rgb, alpha)
    mask = yellow if yellow.sum() > 500 else alpha
    ys, xs = np.where(mask)
    return float(xs.mean()), float(ys.mean())


def _paste_origin(anchor: tuple[float, float], ref_anchor: tuple[float, float]) -> tuple[int, int]:
    ax, ay = anchor
    ref_x, ref_y = ref_anchor
    px = int(round(CANVAS_PAD + (ref_x - ax)))
    py = int(round(CANVAS_PAD + (ref_y - ay)))
    return px, py


def process_frames(sheet_path: Path, out_dir: Path, *, audit: bool = False) -> dict:
    sheet = Image.open(sheet_path)
    ref_cell = cell_array(sheet, 0)
    shared_outer = find_frame_bounds(ref_cell[..., :3])

    ref_crop = prepare_cell(ref_cell, shared_outer)
    ref_anchor = registration_point(ref_crop)
    crop_h, crop_w = ref_crop.shape[0], ref_crop.shape[1]

    placements: list[tuple[np.ndarray, int, int]] = []
    outliers: list[int] = []
    for i in range(FRAME_COUNT):
        arr = cell_array(sheet, i)
        crop = prepare_cell(arr, shared_outer)
        if crop.shape != (crop_h, crop_w, 4):
            outliers.append(i)
        px, py = _paste_origin(registration_point(crop), ref_anchor)
        placements.append((crop, px, py))

    min_px = min(px for _, px, _ in placements)
    min_py = min(py for _, _, py in placements)
    max_rx = max(px + crop_w for _, px, _ in placements)
    max_by = max(py + crop_h for _, _, py in placements)
    canvas_w = max_rx - min_px + CANVAS_PAD
    canvas_h = max_by - min_py + CANVAS_PAD

    drift: list[tuple[int, float, float]] = []
    ref_canvas_centroid: tuple[float, float] | None = None
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, (crop, px, py) in enumerate(placements):
        shifted_px = px - min_px + CANVAS_PAD
        shifted_py = py - min_py + CANVAS_PAD
        canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
        h, w = crop.shape[:2]
        canvas[shifted_py : shifted_py + h, shifted_px : shifted_px + w] = crop
        Image.fromarray(canvas).save(out_dir / f"banana-{i:02d}.png", optimize=True)
        cx, cy = measure_registration(canvas)
        if i == 0:
            ref_canvas_centroid = (cx, cy)
            drift.append((0, 0.0, 0.0))
        else:
            assert ref_canvas_centroid is not None
            drift.append((i, cx - ref_canvas_centroid[0], cy - ref_canvas_centroid[1]))

    meta: dict = {
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "crop_w": crop_w,
        "crop_h": crop_h,
        "shared_outer": shared_outer,
        "frame_inset": FRAME_INSET,
        "anchor": ref_anchor,
    }
    if audit:
        meta["shape_mismatch"] = outliers
        meta["anchor_drift_px"] = drift
        meta["max_drift"] = max((abs(dx) + abs(dy) for _, dx, dy in drift), default=0.0)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    meta = process_frames(args.sheet, args.out, audit=args.audit)
    print(meta)


if __name__ == "__main__":
    main()