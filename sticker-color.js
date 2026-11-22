import {
  readImageDataFromImage,
  renderTintedToDataUrl,
  scaleDimensions,
} from "./luminance-tint.js";
import { DEFAULT_POSTER_HSV } from "./hsv-color.js";

const STICKER_MAX_LONG = 640;
const TINT_CACHE_MAX = 96;

/** @type {Map<string, ImageData>} */
const sourceBySrc = new Map();
/** @type {Map<string, { w: number, h: number }>} */
const dimsBySrc = new Map();
/** @type {Map<string, string>} */
const tintUrlCache = new Map();

function hsvKey(hsv) {
  return `${hsv.h.toFixed(1)},${hsv.s.toFixed(3)},${hsv.v.toFixed(3)}`;
}

function cacheKey(src, hsv) {
  return `${src}|${hsvKey(hsv)}`;
}

function pruneTintCache() {
  if (tintUrlCache.size <= TINT_CACHE_MAX) return;
  const keys = [...tintUrlCache.keys()];
  for (let i = 0; i < keys.length - TINT_CACHE_MAX; i += 1) tintUrlCache.delete(keys[i]);
}

async function ensureStickerSource(src) {
  if (sourceBySrc.has(src)) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = src;
  });
  const dims = scaleDimensions(img.naturalWidth, img.naturalHeight, STICKER_MAX_LONG);
  dimsBySrc.set(src, dims);
  sourceBySrc.set(src, readImageDataFromImage(img, dims.w, dims.h));
}

export function stickerUsesCustomTint(el) {
  return el?.dataset.stickerTint === "1";
}

export function parseStickerHsv(el) {
  const h = parseFloat(el?.dataset.stickerH ?? String(DEFAULT_POSTER_HSV.h));
  const s = parseFloat(el?.dataset.stickerS ?? String(DEFAULT_POSTER_HSV.s));
  const v = parseFloat(el?.dataset.stickerV ?? String(DEFAULT_POSTER_HSV.v));
  return {
    h: Number.isFinite(h) ? h : DEFAULT_POSTER_HSV.h,
    s: Number.isFinite(s) ? s : DEFAULT_POSTER_HSV.s,
    v: Number.isFinite(v) ? v : DEFAULT_POSTER_HSV.v,
  };
}

export function writeStickerHsv(el, hsv) {
  el.dataset.stickerTint = "1";
  el.dataset.stickerH = String(hsv.h);
  el.dataset.stickerS = String(hsv.s);
  el.dataset.stickerV = String(hsv.v);
}

function getTintedUrl(src, hsv) {
  const key = cacheKey(src, hsv);
  const hit = tintUrlCache.get(key);
  if (hit) return hit;
  const source = sourceBySrc.get(src);
  const dims = dimsBySrc.get(src);
  if (!source || !dims) return null;
  const url = renderTintedToDataUrl(source, dims.w, dims.h, hsv, "image/png");
  tintUrlCache.set(key, url);
  pruneTintCache();
  return url;
}

export async function applyStickerTintToElement(el) {
  const img = el?.querySelector(".placed-sticker-img");
  const src = el?.dataset.stickerSrc;
  if (!img || !src) return;
  if (!stickerUsesCustomTint(el)) {
    img.src = src;
    return;
  }
  await ensureStickerSource(src);
  const hsv = parseStickerHsv(el);
  const url = getTintedUrl(src, hsv);
  if (url) img.src = url;
}

export function initStickerTints() {
  return {
    ensureExportReady: async () => {},
    ensureSource: ensureStickerSource,
    apply: applyStickerTintToElement,
  };
}