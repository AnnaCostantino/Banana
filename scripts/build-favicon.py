#!/usr/bin/env python3
"""Build favicons from frames/banana-12.png."""
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frames" / "banana-12.png"
POSTER_YELLOW = (244, 223, 58, 255)


def content_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    rgba = im.convert("RGBA")
    w, h = rgba.size
    pixels = rgba.load()
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a < 8:
                continue
            if r + g + b < 40:
                continue
            found = True
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
    if not found:
        return 0, 0, w, h
    pad = max(8, int(0.02 * max(w, h)))
    return (
        max(0, min_x - pad),
        max(0, min_y - pad),
        min(w, max_x + pad + 1),
        min(h, max_y + pad + 1),
    )


def square_icon(im: Image.Image, size: int, rotate_deg: float = -28) -> Image.Image:
    if rotate_deg:
        im = im.rotate(rotate_deg, resample=Image.Resampling.BICUBIC, expand=True)
    side = max(im.width, im.height)
    fill = side * 0.9
    scale = fill / max(im.width, im.height)
    new_w = max(1, int(im.width * scale))
    new_h = max(1, int(im.height * scale))
    resized = im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (side, side), POSTER_YELLOW)
    ox = (side - new_w) // 2
    oy = (side - new_h) // 2
    canvas.paste(resized, (ox, oy), resized)
    out = canvas.resize((size, size), Image.Resampling.LANCZOS)
    if size <= 32:
        out = out.filter(ImageFilter.SHARPEN)
    return out


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    bbox = content_bbox(src)
    crop = src.crop(bbox)

    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)

    for size in (16, 32):
        icon = square_icon(crop, size)
        icon.save(assets / f"favicon-{size}.png", optimize=True)

    icon32 = square_icon(crop, 32)
    icon32.save(ROOT / "favicon.png", optimize=True)
    icon32.save(assets / "favicon-32.png", optimize=True)

    square_icon(crop, 180).save(assets / "apple-touch-icon.png", optimize=True)

    icon16 = square_icon(crop, 16)
    icon32 = square_icon(crop, 32)
    icon16.save(ROOT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=[icon32])
    print("wrote favicon.ico, favicon.png, assets/favicon-{16,32}.png, assets/apple-touch-icon.png")


if __name__ == "__main__":
    main()