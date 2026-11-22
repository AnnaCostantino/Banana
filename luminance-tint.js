import { DEFAULT_POSTER_HSV } from "./hsv-color.js";

/** Pixels darker than this (relative luminance) stay original ink/specks. */
export const DARK_LUMINANCE = 0.165;

export function rgbToHsl255(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

export function hslToRgb255(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function relativeLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Luminance-masked HSL retint (poster paper / banana peel).
 * @param {Uint8ClampedArray} source RGBA buffer
 * @param {number} targetH
 * @param {number} targetS 0–1
 * @param {number} targetV 0–1
 * @param {number} [valRef] reference value for brightness scale (defaults to poster yellow)
 */
export function tintImageDataRGBA(source, targetH, targetS, targetV, valRef = DEFAULT_POSTER_HSV.v) {
  const out = new Uint8ClampedArray(source.length);
  const valScale = targetV / valRef;
  for (let i = 0; i < source.length; i += 4) {
    const sr = source[i];
    const sg = source[i + 1];
    const sb = source[i + 2];
    const a = source[i + 3];
    const lum = relativeLuminance(sr, sg, sb);
    if (lum < DARK_LUMINANCE) {
      out[i] = sr;
      out[i + 1] = sg;
      out[i + 2] = sb;
      out[i + 3] = a;
      continue;
    }
    const srcHsl = rgbToHsl255(sr, sg, sb);
    const mixS = Math.min(1, targetS * (0.25 + 0.75 * Math.min(1, srcHsl.s * 1.15)));
    const mixL = Math.min(0.99, srcHsl.l * (0.88 + 0.12 * valScale));
    const { r, g, b } = hslToRgb255(targetH, mixS, mixL);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }
  return out;
}

export function readImageDataFromImage(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function renderTintedToDataUrl(sourceData, w, h, hsv, mime = "image/png") {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const tinted = tintImageDataRGBA(sourceData.data, hsv.h, hsv.s, hsv.v);
  ctx.putImageData(new ImageData(tinted, w, h), 0, 0);
  return c.toDataURL(mime, mime === "image/jpeg" ? 0.92 : undefined);
}

export function scaleDimensions(w, h, maxLong) {
  const long = Math.max(w, h);
  if (long <= maxLong) return { w, h };
  const scale = maxLong / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}