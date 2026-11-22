import { DEFAULT_POSTER_HSV } from "./hsv-color.js";
import {
  readImageDataFromImage,
  renderTintedToDataUrl,
  scaleDimensions,
} from "./luminance-tint.js";

const FRAME_MAX_LONG = 960;
const TINT_CACHE_MAX = 64;

/** @type {Map<number, ImageData>} */
const frameSourceCache = new Map();
/** @type {Map<string, string>} */
const tintUrlCache = new Map();

let workW = 0;
let workH = 0;
let framesReady = null;

function hsvKey(hsv) {
  return `${hsv.h.toFixed(1)},${hsv.s.toFixed(3)},${hsv.v.toFixed(3)}`;
}

function cacheKey(frameIndex, hsv) {
  return `${frameIndex}|${hsvKey(hsv)}`;
}

function pruneTintCache() {
  if (tintUrlCache.size <= TINT_CACHE_MAX) return;
  const keys = [...tintUrlCache.keys()];
  for (let i = 0; i < keys.length - TINT_CACHE_MAX; i += 1) tintUrlCache.delete(keys[i]);
}

export function parseBananaHsv(el) {
  const h = parseFloat(el?.dataset.bananaH ?? String(DEFAULT_POSTER_HSV.h));
  const s = parseFloat(el?.dataset.bananaS ?? String(DEFAULT_POSTER_HSV.s));
  const v = parseFloat(el?.dataset.bananaV ?? String(DEFAULT_POSTER_HSV.v));
  return {
    h: Number.isFinite(h) ? h : DEFAULT_POSTER_HSV.h,
    s: Number.isFinite(s) ? s : DEFAULT_POSTER_HSV.s,
    v: Number.isFinite(v) ? v : DEFAULT_POSTER_HSV.v,
  };
}

export function writeBananaHsv(el, hsv) {
  el.dataset.bananaH = String(hsv.h);
  el.dataset.bananaS = String(hsv.s);
  el.dataset.bananaV = String(hsv.v);
}

function getTintedUrl(frameIndex, hsv) {
  const key = cacheKey(frameIndex, hsv);
  const hit = tintUrlCache.get(key);
  if (hit) return hit;
  const src = frameSourceCache.get(frameIndex);
  if (!src) return null;
  const url = renderTintedToDataUrl(src, workW, workH, hsv, "image/png");
  tintUrlCache.set(key, url);
  pruneTintCache();
  return url;
}

export function applyBananaTintToElement(bananaEl, frameIndex) {
  const img = bananaEl?.querySelector(".placed-banana-img");
  if (!img) return;
  const hsv = parseBananaHsv(bananaEl);
  const url = getTintedUrl(frameIndex, hsv);
  if (url) img.src = url;
}

async function ensureFramesLoaded(frameSrc, frameCount) {
  if (framesReady) return framesReady;
  framesReady = (async () => {
    const first = new Image();
    first.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      first.onload = () => res();
      first.onerror = rej;
      first.src = frameSrc(0);
    });
    const dims = scaleDimensions(first.naturalWidth, first.naturalHeight, FRAME_MAX_LONG);
    workW = dims.w;
    workH = dims.h;
    for (let i = 0; i < frameCount; i += 1) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = rej;
        img.src = frameSrc(i);
      });
      frameSourceCache.set(i, readImageDataFromImage(img, workW, workH));
    }
  })();
  return framesReady;
}

export function initBananaTints(options) {
  ensureFramesLoaded(options.frameSrc, options.frameCount).catch((err) =>
    console.error("Banana frame load failed", err)
  );

  return {
    applyNewBanana: (el, bruiseIndex, hsv) => {
      if (hsv) writeBananaHsv(el, hsv);
      applyBananaTintToElement(el, bruiseIndex);
    },
    onBruiseChange: (el, bruiseIndex) => applyBananaTintToElement(el, bruiseIndex),
    ensureExportReady: () => ensureFramesLoaded(options.frameSrc, options.frameCount),
  };
}