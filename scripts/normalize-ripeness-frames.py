#!/usr/bin/env python3
"""Slice the borderless ripeness sheet into aligned PNG frames (no border stripping)."""
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
    if x1 > sheet_w or y1 > sheet_h:
        raise ValueError(f"Cell {idx} box {(x0, y0, x1, y1)} exceeds sheet {sheet_w}x{sheet_h}")
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


def _yellow_mask(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    return (
        (rgb[..., 0] > 70)
        & (rgb[..., 1] > 70)
        & (rgb[..., 2] < rgb[..., 0])
        & alpha
    )


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
    return registration_point(canvas)


def _paste_origin(anchor: tuple[float, float], ref_anchor: tuple[float, float]) -> tuple[int, int]:
    ref_x, ref_y = ref_anchor
    ax, ay = anchor
    px = int(round(CANVAS_PAD + (ref_x - ax)))
    py = int(round(CANVAS_PAD + (ref_y - ay)))
    return px, py


def process_frames(sheet_path: Path, out_dir: Path, *, audit: bool = False) -> dict:
    sheet = Image.open(sheet_path)
    sheet_w, sheet_h = sheet_size(sheet)
    if sheet_w != COLS * CELL_W:
        raise ValueError(f"Expected sheet width {COLS * CELL_W}, got {sheet_w}")

    cells: list[np.ndarray] = []
    anchors: list[tuple[float, float]] = []
    placements: list[tuple[np.ndarray, int, int, int, int]] = []

    for i in range(FRAME_COUNT):
        crop = clear_paper(cell_array(sheet, i))
        anchor = registration_point(crop)
        cells.append(crop)
        anchors.append(anchor)

    ref_anchor = anchors[0]
    for crop, anchor in zip(cells, anchors):
        px, py = _paste_origin(anchor, ref_anchor)
        h, w = crop.shape[:2]
        placements.append((crop, px, py, w, h))

    min_px = min(px for _, px, _, _, _ in placements)
    min_py = min(py for _, _, py, _, _ in placements)
    max_rx = max(px + w for _, px, _, w, _ in placements)
    max_by = max(py + h for _, _, py, _, h in placements)
    canvas_w = max_rx - min_px + CANVAS_PAD
    canvas_h = max_by - min_py + CANVAS_PAD

    drift: list[tuple[int, float, float]] = []
    ref_centroid: tuple[float, float] | None = None
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, (crop, px, py, w, h) in enumerate(placements):
        sx = px - min_px + CANVAS_PAD
        sy = py - min_py + CANVAS_PAD
        canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
        canvas[sy : sy + h, sx : sx + w] = crop
        Image.fromarray(canvas).save(out_dir / f"banana-{i:02d}.png", optimize=True)
        cx, cy = measure_registration(canvas)
        if i == 0:
            ref_centroid = (cx, cy)
            drift.append((0, 0.0, 0.0))
        else:
            assert ref_centroid is not None
            drift.append((i, cx - ref_centroid[0], cy - ref_centroid[1]))

    meta: dict = {
        "sheet": str(sheet_path),
        "sheet_w": sheet_w,
        "sheet_h": sheet_h,
        "canvas_w": canvas_w,
        "canvas_h": canvas_h,
        "anchor": ref_anchor,
    }
    if audit:
        meta["anchor_drift_px"] = drift
        meta["max_drift"] = max((abs(dx) + abs(dy) for _, dx, dy in drift), default=0.0)
        meta["cell_sizes"] = sorted({(c.shape[1], c.shape[0]) for c in cells})
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
    meta = process_frames(args.sheet, args.out, audit=args.audit)
    print(meta)


if __name__ == "__main__":
    main()