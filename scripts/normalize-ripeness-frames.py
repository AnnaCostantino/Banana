#!/usr/bin/env python3
"""Slice ripeness frames from the risograph sheet with border removal and alignment."""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

CELL_W, CELL_H = 1375, 739
COLS = 4
FRAME_COUNT = 31
PAD_INSIDE = 16
PAPER_THR = 168
EDGE_LUM = 92


def cell_array(sheet: Image.Image, idx: int) -> np.ndarray:
    row, col = divmod(idx, COLS)
    box = (col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H)
    return np.array(sheet.crop(box).convert("RGBA"))


def find_frame_bounds(rgb: np.ndarray) -> tuple[int | None, int | None, int | None, int | None]:
    h, w = rgb.shape[:2]
    black = (rgb[..., 0] < 55) & (rgb[..., 1] < 55) & (rgb[..., 2] < 55)

    def scan_row(start: int, stop: int, step: int) -> int | None:
        for y in range(start, stop, step):
            if black[y].mean() > 0.8:
                return y
        return None

    def scan_col(start: int, stop: int, step: int) -> int | None:
        for x in range(start, stop, step):
            if black[:, x].mean() > 0.8:
                return x
        return None

    top = scan_row(0, min(220, h), 1)
    bottom = scan_row(h - 1, max(h - 220, -1), -1)
    left = scan_col(0, min(220, w), 1)
    right = scan_col(w - 1, max(w - 220, -1), -1)

    if top is not None:
        xs = np.where(black[top])[0]
        if xs.size:
            left = max(left or int(xs[0]), int(xs[0]))
            right = min(right or int(xs[-1]), int(xs[-1]))
    if bottom is not None:
        xs = np.where(black[bottom])[0]
        if xs.size:
            left = max(left or int(xs[0]), int(xs[0]))
            right = min(right or int(xs[-1]), int(xs[-1]))

    return top, bottom, left, right


def fallback_bounds() -> tuple[int, int, int, int]:
    return 116, 722, 116, 1348


def crop_inside(arr: np.ndarray, bounds: tuple[int | None, int | None, int | None, int | None]) -> np.ndarray:
    ft, fb, fl, fr = fallback_bounds()
    top, bottom, _left, _right = bounds
    top = top if top is not None else ft
    bottom = bottom if bottom is not None else fb
    # Sheet frame spans consistent left/right; only ripeness moves vertically.
    left, right = fl, fr
    top += PAD_INSIDE
    bottom -= PAD_INSIDE
    left += PAD_INSIDE
    right -= PAD_INSIDE
    return arr[top : bottom + 1, left : right + 1].copy()


def clear_paper(arr: np.ndarray) -> np.ndarray:
    out = arr.copy()
    rgb = out[..., :3]
    lum = rgb.max(axis=2)
    yellow = (rgb[..., 0] > 75) & (rgb[..., 1] > 75) & (rgb[..., 2] < rgb[..., 0])
    paper = (rgb[..., 0] >= PAPER_THR) & (rgb[..., 1] >= PAPER_THR) & (rgb[..., 2] >= PAPER_THR)
    grey_scrim = (lum >= 155) & (lum <= 215) & ~yellow
    out[paper | grey_scrim, 3] = 0
    return out


def flood_remove_edge_ink(arr: np.ndarray, lum: int = EDGE_LUM) -> np.ndarray:
    h, w = arr.shape[:2]
    out = arr.copy()
    ink = out[..., 3] > 0
    dark = out[..., :3].max(axis=2) < lum
    q: deque[tuple[int, int]] = deque()
    seen = np.zeros((h, w), dtype=bool)
    for x in range(w):
        for y in (0, h - 1):
            if ink[y, x] and dark[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if ink[y, x] and dark[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    remove = np.zeros((h, w), dtype=bool)
    while q:
        y, x = q.popleft()
        remove[y, x] = True
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and ink[ny, nx] and dark[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    out[remove, 3] = 0
    return out


def strip_spanning_lines(arr: np.ndarray) -> np.ndarray:
    """Delete long straight dark strokes left from the printed cell frame."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 0
    dark = ink & (lum < 95)

    row_cover = dark.mean(axis=1)
    col_cover = dark.mean(axis=0)
    for y, cover in enumerate(row_cover):
        if cover < 0.28:
            continue
        row_dark = dark[y]
        if row_dark.mean() > 0.45 and lum[y, row_dark].mean() < 70:
            out[y, row_dark, 3] = 0
    for x, cover in enumerate(col_cover):
        if cover < 0.28:
            continue
        col_dark = dark[:, x]
        if col_dark.mean() > 0.45 and lum[col_dark, x].mean() < 70:
            out[col_dark, x, 3] = 0
    return out


def strip_light_lines(arr: np.ndarray, rim: int = 96) -> np.ndarray:
    """Remove pale scan/grid strokes in the outer rim (common on rotten frames)."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 0
    light = ink & (lum >= 118) & (lum <= 238)
    for y in list(range(min(rim, h))) + list(range(max(0, h - rim), h)):
        if light[y].mean() > 0.14:
            out[y, light[y], 3] = 0
    for x in list(range(min(rim, w))) + list(range(max(0, w - rim), w)):
        if light[:, x].mean() > 0.14:
            out[light[:, x], x, 3] = 0
    return out


def remove_line_art(arr: np.ndarray) -> np.ndarray:
    """Remove 1–6 px horizontal/vertical stroke remnants from the cell frame."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)
    ink = out[..., 3] > 0
    dark = ink & (lum < 75)

    y = 0
    while y < h:
        if dark[y].mean() < 0.32:
            y += 1
            continue
        y2 = y + 1
        while y2 < h and dark[y2].mean() > 0.28:
            y2 += 1
        thickness = y2 - y
        band_cov = dark[y:y2].mean()
        if thickness <= 6 and band_cov > 0.42:
            band = dark[y:y2]
            out[y:y2][band, 3] = 0
        y = y2

    x = 0
    while x < w:
        if dark[:, x].mean() < 0.32:
            x += 1
            continue
        x2 = x + 1
        while x2 < w and dark[:, x2].mean() > 0.28:
            x2 += 1
        thickness = x2 - x
        band_cov = dark[:, x:x2].mean()
        if thickness <= 6 and band_cov > 0.42:
            band = dark[:, x:x2]
            out[:, x:x2][band, 3] = 0
        x = x2
    return out


def peel_edge_bands(arr: np.ndarray, depth: int = 14) -> np.ndarray:
    """Drop thin dark bands on the outer rim (leftover frame strokes)."""
    out = arr.copy()
    h, w = out.shape[:2]
    lum = out[..., :3].max(axis=2)

    def band_is_frame(y0: int, y1: int, x0: int, x1: int) -> bool:
        region = out[y0:y1, x0:x1]
        opaque = region[..., 3] > 0
        if opaque.sum() == 0:
            return False
        dark = (region[..., :3].max(axis=2) < 90) & opaque
        return dark.sum() / opaque.sum() > 0.55

    for _ in range(2):
        if band_is_frame(0, min(depth, h), 0, w):
            out[:depth, :, 3] = 0
        if band_is_frame(h - min(depth, h), h, 0, w):
            out[h - depth :, :, 3] = 0
        if band_is_frame(0, h, 0, min(depth, w)):
            out[:, :depth, 3] = 0
        if band_is_frame(0, h, w - min(depth, w), w):
            out[:, w - depth :, 3] = 0
        lum = out[..., :3].max(axis=2)
    return out


def registration_point(arr: np.ndarray) -> tuple[float, float]:
    rgb = arr[..., :3]
    lum = rgb.max(axis=2)
    alpha = arr[..., 3] > 8
    yellow = (
        (rgb[..., 0] > 75)
        & (rgb[..., 1] > 75)
        & (rgb[..., 2] < rgb[..., 0])
        & alpha
    )
    bright_yellow = yellow & (lum > 110)
    mask = bright_yellow if bright_yellow.sum() > 600 else yellow if yellow.sum() > 800 else (lum > 60) & alpha
    ys, xs = np.where(mask)
    if xs.size == 0:
        ys, xs = np.where(alpha)
    return float(xs.mean()), float(ys.mean())


def alpha_bbox(arr: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(arr[..., 3] > 8)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def process_frames(sheet_path: Path, out_dir: Path) -> dict[str, float | int | tuple[int, int]]:
    sheet = Image.open(sheet_path)
    crops: list[np.ndarray] = []
    anchors: list[tuple[float, float]] = []

    for i in range(FRAME_COUNT):
        arr = cell_array(sheet, i)
        bounds = find_frame_bounds(arr[..., :3])
        crop = crop_inside(arr, bounds)
        crop = clear_paper(crop)
        crop = flood_remove_edge_ink(crop)
        crop = peel_edge_bands(crop)
        crop = strip_spanning_lines(crop)
        crop = remove_line_art(crop)
        crops.append(crop)
        anchors.append(registration_point(crop))

    ref_x, ref_y = anchors[0]
    pad = 12
    max_w = max(c.shape[1] for c in crops)
    max_h = max(c.shape[0] for c in crops)
    canvas_w = max_w + pad * 2
    canvas_h = max_h + pad * 2

    aligned: list[np.ndarray] = []
    for i, crop in enumerate(crops):
        ax, ay = anchors[i]
        px = int(round(pad + (ref_x - ax)))
        py = int(round(pad + (ref_y - ay)))
        canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
        h, w = crop.shape[:2]
        x0 = max(0, px)
        y0 = max(0, py)
        x1 = min(canvas_w, px + w)
        y1 = min(canvas_h, py + h)
        sx0 = x0 - px
        sy0 = y0 - py
        canvas[y0:y1, x0:x1] = crop[sy0 : sy0 + (y1 - y0), sx0 : sx0 + (x1 - x0)]
        aligned.append(canvas)

    union = None
    for canvas in aligned:
        bb = alpha_bbox(canvas)
        if union is None:
            union = list(bb)
        else:
            union[0] = min(union[0], bb[0])
            union[1] = min(union[1], bb[1])
            union[2] = max(union[2], bb[2])
            union[3] = max(union[3], bb[3])
    margin = 8
    x0 = max(0, union[0] - margin)
    y0 = max(0, union[1] - margin)
    x1 = min(canvas_w - 1, union[2] + margin)
    y1 = min(canvas_h - 1, union[3] + margin)
    viewport_w = x1 - x0 + 1
    viewport_h = y1 - y0 + 1

    out_dir.mkdir(parents=True, exist_ok=True)
    for i, canvas in enumerate(aligned):
        final = canvas[y0 : y1 + 1, x0 : x1 + 1].copy()
        final = peel_edge_bands(final, depth=10)
        final = flood_remove_edge_ink(final, lum=100)
        final = strip_spanning_lines(final)
        final = remove_line_art(final)
        final = strip_light_lines(final)
        Image.fromarray(final).save(out_dir / f"banana-{i:02d}.png", optimize=True)

    return {
        "canvas_w": viewport_w,
        "canvas_h": viewport_h,
        "pad_inside": PAD_INSIDE,
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