import { DEFAULT_POSTER_HSV, bindHsvPicker, hsvToHex } from "./hsv-color.js";

/** Pixels darker than this (relative luminance) stay original ink/specks. */
const DARK_LUMINANCE = 0.165;
const PREVIEW_MAX_LONG_EDGE = 1200;
const FULL_RENDER_DEBOUNCE_MS = 280;

function rgbToHsl255(r, g, b) {
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

function hslToRgb255(h, s, l) {
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

function relativeLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function tintImageData(source, targetH, targetS, targetV) {
  const out = new Uint8ClampedArray(source.length);
  const valScale = targetV / DEFAULT_POSTER_HSV.v;
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

let textureEl;
let artboardEl;
let previewCanvas;
let fullCanvas;
let sourcePreview = null;
let sourceFull = null;
let sourceW = 0;
let sourceH = 0;
let previewW = 0;
let previewH = 0;
let currentHsv = { ...DEFAULT_POSTER_HSV };
let lastObjectUrl = null;
let fullRenderTimer = null;
let fullReady = false;
let pickerApi = null;
let panelExpanded = false;

function scaleDimensions(w, h, maxLong) {
  const long = Math.max(w, h);
  if (long <= maxLong) return { w, h, scale: 1 };
  const scale = maxLong / long;
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

function readSourceFromImage(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function renderToCanvas(targetCanvas, sourceData, w, h, hsv) {
  targetCanvas.width = w;
  targetCanvas.height = h;
  const ctx = targetCanvas.getContext("2d");
  const tinted = tintImageData(sourceData.data, hsv.h, hsv.s, hsv.v);
  const out = new ImageData(tinted, w, h);
  ctx.putImageData(out, 0, 0);
}

function applyArtboardColor(hsv) {
  if (!artboardEl) return;
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  artboardEl.style.background = hex;
  artboardEl.style.setProperty("--poster-tint", hex);
}

function setTextureFromCanvas(canvas, useFullRes) {
  if (!textureEl) return;
  if (lastObjectUrl) {
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
  if (useFullRes) {
    fullReady = true;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        lastObjectUrl = URL.createObjectURL(blob);
        textureEl.src = lastObjectUrl;
      },
      "image/jpeg",
      0.94
    );
    return;
  }
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  textureEl.src = dataUrl;
}

function applyTintPreview() {
  if (!sourcePreview || !previewCanvas) return;
  renderToCanvas(previewCanvas, sourcePreview, previewW, previewH, currentHsv);
  setTextureFromCanvas(previewCanvas, false);
  applyArtboardColor(currentHsv);
}

function scheduleFullRender() {
  if (!sourceFull || !fullCanvas) return;
  fullReady = false;
  if (fullRenderTimer) clearTimeout(fullRenderTimer);
  fullRenderTimer = setTimeout(() => {
    fullRenderTimer = null;
    renderToCanvas(fullCanvas, sourceFull, sourceW, sourceH, currentHsv);
    setTextureFromCanvas(fullCanvas, true);
  }, FULL_RENDER_DEBOUNCE_MS);
}

function onPickerChange(hsv) {
  currentHsv = hsv;
  applyTintPreview();
  scheduleFullRender();
}

async function loadSourceImage(src) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
  sourceW = img.naturalWidth;
  sourceH = img.naturalHeight;
  const preview = scaleDimensions(sourceW, sourceH, PREVIEW_MAX_LONG_EDGE);
  previewW = preview.w;
  previewH = preview.h;
  sourceFull = readSourceFromImage(img, sourceW, sourceH);
  sourcePreview = readSourceFromImage(img, previewW, previewH);
  previewCanvas = document.createElement("canvas");
  fullCanvas = document.createElement("canvas");
  applyTintPreview();
  scheduleFullRender();
}

function setPanelExpanded(expanded) {
  panelExpanded = expanded;
  const { panelEl, trayWrapEl, toggleBtn } = initPosterColor._els || {};
  if (panelEl) {
    panelEl.classList.toggle("is-collapsed", !expanded);
    panelEl.classList.toggle("is-expanded", expanded);
  }
  if (trayWrapEl) trayWrapEl.hidden = !expanded;
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(expanded));
}

export function initPosterColor(options) {
  textureEl = options.textureEl;
  artboardEl = options.artboardEl;
  const {
    panelEl,
    toggleBtn,
    trayWrapEl,
    svEl,
    hueEl,
    svPointer,
    huePointer,
    resetBtn,
    sourceSrc,
  } = options;
  initPosterColor._els = { panelEl, trayWrapEl, toggleBtn };

  toggleBtn?.addEventListener("click", () => setPanelExpanded(!panelExpanded));
  setPanelExpanded(false);

  pickerApi = bindHsvPicker({
    svEl,
    hueEl,
    svPointer,
    huePointer,
    initial: DEFAULT_POSTER_HSV,
    onChange: onPickerChange,
    stopPropagationEl: trayWrapEl,
  });

  resetBtn?.addEventListener("click", () => {
    pickerApi.setHsv(DEFAULT_POSTER_HSV);
  });

  loadSourceImage(sourceSrc).catch((err) => console.error("Poster color load failed", err));

  return {
    ensureExportReady: () =>
      new Promise((resolve) => {
        if (fullReady) {
          resolve();
          return;
        }
        if (!sourceFull || !fullCanvas) {
          resolve();
          return;
        }
        if (fullRenderTimer) {
          clearTimeout(fullRenderTimer);
          fullRenderTimer = null;
        }
        renderToCanvas(fullCanvas, sourceFull, sourceW, sourceH, currentHsv);
        setTextureFromCanvas(fullCanvas, true);
        const check = () => {
          if (fullReady) resolve();
          else setTimeout(check, 40);
        };
        check();
      }),
    getCurrentHsv: () => ({ ...currentHsv }),
  };
}