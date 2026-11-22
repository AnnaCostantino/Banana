import { DEFAULT_POSTER_HSV, bindHsvPicker, hsvToHex } from "./hsv-color.js";
import {
  readImageDataFromImage,
  scaleDimensions,
  tintImageDataRGBA,
} from "./luminance-tint.js";

const PREVIEW_MAX_LONG_EDGE = 1200;
const FULL_RENDER_DEBOUNCE_MS = 280;

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

function renderToCanvas(targetCanvas, sourceData, w, h, hsv) {
  targetCanvas.width = w;
  targetCanvas.height = h;
  const ctx = targetCanvas.getContext("2d");
  const tinted = tintImageDataRGBA(sourceData.data, hsv.h, hsv.s, hsv.v);
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
  sourceFull = readImageDataFromImage(img, sourceW, sourceH);
  sourcePreview = readImageDataFromImage(img, previewW, previewH);
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