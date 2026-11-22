import { rotationFor } from "./rotation.js";
import { parseBananaHsv } from "./banana-color.js";
import { parseStickerHsv, stickerUsesCustomTint } from "./sticker-color.js";

export const PASTE_OFFSET_PX = 16;

export function offsetPct(canvasEl, px = PASTE_OFFSET_PX) {
  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return { dx: 1.2, dy: 1.2 };
  return { dx: (px / rect.width) * 100, dy: (px / rect.height) * 100 };
}

function readStickerSrc(el) {
  const fromDataset = el.dataset.stickerSrc;
  if (fromDataset) return fromDataset;
  const img = el.querySelector(".placed-sticker-img");
  if (!img?.src) return "";
  try {
    const url = new URL(img.src, window.location.href);
    return url.pathname.startsWith("/") ? `.${url.pathname}` : url.pathname;
  } catch {
    return img.getAttribute("src") || img.src;
  }
}

/** @returns {object | null} */
export function serializeSelection(el, kind) {
  if (!el) return null;
  const base = {
    kind,
    x: parseFloat(el.dataset.x),
    y: parseFloat(el.dataset.y),
    w: parseFloat(el.dataset.w),
    h: parseFloat(el.dataset.h),
    rotation: rotationFor(el),
  };
  if (kind === "banana") {
    const hsv = parseBananaHsv(el);
    return {
      ...base,
      aspect: el.dataset.aspect,
      bruiseIndex: parseInt(el.dataset.bruiseIndex ?? "12", 10),
      bananaH: hsv.h,
      bananaS: hsv.s,
      bananaV: hsv.v,
    };
  }
  if (kind === "sticker") {
    const sticker = {
      ...base,
      aspect: el.dataset.aspect,
      stickerSrc: readStickerSrc(el),
      placeScaleBoost: parseFloat(el.dataset.placeScaleBoost ?? "1"),
      jitter: el.dataset.jitter,
    };
    if (stickerUsesCustomTint(el)) {
      const hsv = parseStickerHsv(el);
      sticker.stickerTint = "1";
      sticker.stickerH = hsv.h;
      sticker.stickerS = hsv.s;
      sticker.stickerV = hsv.v;
    }
    return sticker;
  }
  if (kind === "shape") {
    return {
      ...base,
      shapeType: el.dataset.shapeType,
      fill: el.dataset.fill,
    };
  }
  return null;
}

export function applyPasteOffset(snapshot, canvasEl, px = PASTE_OFFSET_PX) {
  const { dx, dy } = offsetPct(canvasEl, px);
  return {
    ...snapshot,
    x: snapshot.x + dx,
    y: snapshot.y + dy,
  };
}