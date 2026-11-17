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
SIDE_INSET_EXTRA = 3
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
    left += FRAME_INSET + SIDE_INSET_EXTRA
    right -= FRAME_INSET + SIDE_INSET_EXTRA
    if bottom <= top or right <= left:
        raise ValueError(f"Invalid crop after inset: {top=} {bottom=} {left=} {right=}")
    return arr[top : bottom + 1, left : right + 1].copy()


def _yellow_mask(arr: np.ndarray, ink: np.ndarray) -> np.ndarray:
    return (
        (arr[..., 0] > 70)
        & (arr[..., 1] > 70)
        & (arr[..., 2] < arr[..., 0])
        & ink
    )


def _fruit_core_mask(arr: np.ndarray) -> np.ndarray:
    lum = arr[..., :3].max(axis=2)
    ink = arr[..., 3] > 8
    yellow = _yellow_mask(arr, ink)
    core = yellow if yellow.sum() > 400 else ink & (lum > 48)
    return core if core.any() else ink


def drop_detached_rule_strokes(arr: np.ndarray) -> np.ndarray:
    """Remove pure-black rule strokes outside the fruit core (not halftone flesh)."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 0
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)
    core = _fruit_core_mask(arr)
    ys, xs = np.where(core)
    y_top, y_bot = int(ys.min()), int(ys.max())
    if yellow.sum() > 400:
        _, x_y = np.where(yellow)
        x_left, x_right = int(x_y.min()), int(x_y.max())
    else:
        x_left, x_right = int(xs.min()), int(xs.max())

    for y in range(y_bot + 1, h):
        if yellow[y].sum() > 1:
            continue
        if dark[y].sum() >= max(20, int(w * 0.18)) and dark[y].mean() > 0.28:
            out[y, dark[y], 3] = 0

    y = h - 1
    while y > y_bot:
        if not ink[y].any():
            y -= 1
            continue
        if yellow[y].sum() > 2 or dark[y].mean() < 0.55:
            break
        out[y, dark[y], 3] = 0
        y -= 1

    y = 0
    while y < y_top:
        if not ink[y].any():
            y += 1
            continue
        if yellow[y].sum() > 2 or dark[y].mean() < 0.55:
            break
        out[y, dark[y], 3] = 0
        y += 1

    for x in range(0, x_left):
        if yellow[:, x].sum() > 2:
            continue
        if dark[:, x].mean() > 0.45:
            out[dark[:, x], x, 3] = 0
    for x in range(x_right + 1, w):
        if yellow[:, x].sum() > 2:
            continue
        if dark[:, x].mean() > 0.45:
            out[dark[:, x], x, 3] = 0
    return out


def trim_high_contrast_rules(arr: np.ndarray) -> np.ndarray:
    """Delete near-pure vertical/horizontal rule strokes (dark, almost no yellow)."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 8
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)
    for x in range(w):
        if yellow[:, x].sum() > 14:
            continue
        if dark[:, x].mean() > 0.68:
            out[:, x, 3] = 0
    return out


def trim_embedded_horizontal_rules(arr: np.ndarray, band: int = 28) -> np.ndarray:
    """Clear partial bottom/top sheet rules that sit just above banana tips."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 8
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)
    yel_cap = max(96, int(w * 0.10))
    for y in range(max(0, h - band), h):
        if dark[y].sum() < int(w * 0.52):
            continue
        if yellow[y].sum() > yel_cap:
            continue
        if dark[y].mean() > 0.52:
            out[y, dark[y], 3] = 0
    for y in range(0, min(band, h)):
        if dark[y].sum() < int(w * 0.52):
            continue
        if yellow[y].sum() > yel_cap:
            continue
        if dark[y].mean() > 0.52:
            out[y, dark[y], 3] = 0
    return out


def trim_side_columns_beyond_fruit(arr: np.ndarray, pad: int = 4) -> np.ndarray:
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 8
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)
    if not yellow.any():
        return out
    _, x_y = np.where(yellow)
    x0, x1 = int(x_y.min()), int(x_y.max())
    for x in range(0, max(0, x0 - pad)):
        if yellow[:, x].sum() > 0:
            continue
        if dark[:, x].sum() >= max(12, int(h * 0.05)) and dark[:, x].mean() > 0.18:
            out[dark[:, x], x, 3] = 0
    for x in range(min(w, x1 + pad + 1), w):
        if yellow[:, x].sum() > 0:
            continue
        if dark[:, x].sum() >= max(12, int(h * 0.05)) and dark[:, x].mean() > 0.18:
            out[dark[:, x], x, 3] = 0
    return out


def trim_rule_heavy_edge_columns(arr: np.ndarray, band: int = 32) -> np.ndarray:
    """Drop sheet rule ink on margin columns that still carry a little fruit halftone."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 8
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)
    for x in list(range(min(band, w))) + list(range(max(0, w - band), w)):
        ysum = int(yellow[:, x].sum())
        dsum = int(dark[:, x].sum())
        if dsum < max(48, int(h * 0.06)):
            continue
        if ysum > max(180, dsum // 2):
            continue
        if dark[:, x].mean() > 0.34:
            out[dark[:, x], x, 3] = 0
    return out


def trim_canvas_border_band(arr: np.ndarray, band: int = 20) -> np.ndarray:
    """Clear frame strokes in the outer canvas margin only."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 8
    dark = ink & (lum < 60)
    yellow = _yellow_mask(out, ink)

    for y in list(range(min(band, h))) + list(range(max(0, h - band), h)):
        if yellow[y].sum() > 1:
            continue
        if dark[y].sum() >= max(10, int(w * 0.08)):
            out[y, dark[y], 3] = 0
    for x in list(range(min(band, w))) + list(range(max(0, w - band), w)):
        if yellow[:, x].sum() > 1:
            continue
        if dark[:, x].sum() >= max(10, int(h * 0.06)):
            out[dark[:, x], x, 3] = 0
    return out


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


def polish_canvas(arr: np.ndarray) -> np.ndarray:
    out = drop_detached_rule_strokes(arr)
    out = trim_high_contrast_rules(out)
    out = trim_embedded_horizontal_rules(out)
    out = trim_side_columns_beyond_fruit(out)
    out = trim_rule_heavy_edge_columns(out)
    return trim_canvas_border_band(out)


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
    yellow = _yellow_mask(arr, alpha)
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


def edge_audit_flags(arr: np.ndarray, band: int = 45) -> set[str]:
    """Heuristic check for residual sheet strokes in the canvas margin (build-time only)."""
    h, w = arr.shape[:2]
    lum = arr[..., :3].max(axis=2)
    ink = arr[..., 3] > 8
    dark = ink & (lum < 55)
    yellow = _yellow_mask(arr, ink)
    sides: set[str] = set()
    for y in range(min(band, h)):
        if dark[y].sum() >= w * 0.12 and yellow[y].sum() < 3 and dark[y].mean() > 0.12:
            sides.add("top")
    for y in range(h - band, h):
        if dark[y].sum() >= w * 0.12 and yellow[y].sum() < 3 and dark[y].mean() > 0.12:
            sides.add("bottom")
    for x in range(min(band, w)):
        if dark[:, x].sum() >= h * 0.10 and yellow[:, x].sum() < 3 and dark[:, x].mean() > 0.10:
            sides.add("left")
    for x in range(w - band, w):
        if dark[:, x].sum() >= h * 0.10 and yellow[:, x].sum() < 3 and dark[:, x].mean() > 0.10:
            sides.add("right")
    return sides


def process_frames(sheet_path: Path, out_dir: Path, *, audit: bool = False) -> dict:
    sheet = Image.open(sheet_path)
    crops: list[np.ndarray] = []
    anchors: list[tuple[float, float]] = []

    for i in range(FRAME_COUNT):
        arr = cell_array(sheet, i)
        outer = find_frame_bounds(arr[..., :3])
        crop = crop_inside_frame(arr, outer)
        crop = clear_paper(crop)
        crop = trim_edge_frame_rows(crop)
        crop = drop_detached_rule_strokes(crop)
        crops.append(crop)
        anchors.append(registration_point(crop))

    ref_x, ref_y = anchors[0]
    pad = 8
    max_w = max(c.shape[1] for c in crops)
    max_h = max(c.shape[0] for c in crops)
    canvas_w = max_w + pad * 2
    canvas_h = max_h + pad * 2

    outliers: list[tuple[int, set[str]]] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, crop in enumerate(crops):
        canvas = paste_aligned(crop, *anchors[i], ref_x, ref_y, canvas_w, canvas_h, pad)
        canvas = polish_canvas(canvas)
        Image.fromarray(canvas).save(out_dir / f"banana-{i:02d}.png", optimize=True)
        flags = edge_audit_flags(canvas)
        if flags:
            outliers.append((i, flags))

    meta: dict = {
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "frame_inset": FRAME_INSET,
        "anchor": (ref_x, ref_y),
    }
    if audit:
        meta["edge_outliers"] = outliers
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--audit", action="store_true", help="Report margin stroke heuristics after build")
    args = parser.parse_args()
    meta = process_frames(args.sheet, args.out, audit=args.audit)
    print(meta)


if __name__ == "__main__":
    main()