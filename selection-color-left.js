import {
  DEFAULT_POSTER_HSV,
  bindHsvPicker,
  hexToHsv,
  hsvToRgb,
  rgbToHex,
} from "./hsv-color.js";
import { applyBananaTintToElement, parseBananaHsv, writeBananaHsv } from "./banana-color.js";
import { applyStickerTintToElement, parseStickerHsv, stickerUsesCustomTint, writeStickerHsv } from "./sticker-color.js";

const DEFAULT_SHAPE_FILL = "#1055A8";

let dockEl;
let labelEl;
let pickerApi = null;
let resetBtn = null;
/** @type {{ type: string, el: HTMLElement } | null} */
let colorTarget = null;
let suppressApply = false;

function applyShapeFill(el, hsv) {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(r, g, b);
  el.dataset.fill = hex;
  const graphic = el.querySelector(".shape-graphic");
  if (graphic) graphic.style.color = hex;
}

function readHsvFromTarget(target) {
  if (!target) return { ...DEFAULT_POSTER_HSV };
  const { type, el } = target;
  if (type === "banana") return parseBananaHsv(el);
  if (type === "sticker") {
    return stickerUsesCustomTint(el) ? parseStickerHsv(el) : { ...DEFAULT_POSTER_HSV };
  }
  if (type === "shape") {
    return hexToHsv(el.dataset.fill || DEFAULT_SHAPE_FILL);
  }
  return { ...DEFAULT_POSTER_HSV };
}

function setDockVisible(show) {
  if (!dockEl) return;
  dockEl.hidden = !show;
}

function updateLabel() {
  if (!labelEl || !colorTarget) return;
  const titles = { banana: "Banana color", sticker: "Sticker color", shape: "Shape color" };
  labelEl.textContent = titles[colorTarget.type] || "Color";
}

function onPickerChange(hsv) {
  if (suppressApply || !colorTarget) return;
  const { type, el } = colorTarget;
  if (type === "banana") {
    writeBananaHsv(el, hsv);
    const idx = parseInt(el.dataset.bruiseIndex ?? "12", 10);
    applyBananaTintToElement(el, idx);
    return;
  }
  if (type === "sticker") {
    writeStickerHsv(el, hsv);
    applyStickerTintToElement(el);
    return;
  }
  if (type === "shape") {
    applyShapeFill(el, hsv);
  }
}

function syncPickerFromTarget() {
  if (!pickerApi || !colorTarget) return;
  const hsv = readHsvFromTarget(colorTarget);
  suppressApply = true;
  pickerApi.setHsv(hsv);
  suppressApply = false;
}

export function clearSelectionColorLeft() {
  colorTarget = null;
  setDockVisible(false);
}

export function bindSelectionColorLeft(type, el) {
  if (!el || !["banana", "sticker", "shape"].includes(type)) {
    clearSelectionColorLeft();
    return;
  }
  colorTarget = { type, el };
  setDockVisible(true);
  updateLabel();
  syncPickerFromTarget();
}

export function initSelectionColorLeft(options) {
  dockEl = options.dockEl;
  labelEl = options.labelEl;
  resetBtn = options.resetBtn;

  pickerApi = bindHsvPicker({
    svEl: options.svEl,
    hueEl: options.hueEl,
    svPointer: options.svPointer,
    huePointer: options.huePointer,
    clamp: options.clamp,
    initial: DEFAULT_POSTER_HSV,
    onChange: onPickerChange,
    stopPropagationEl: dockEl,
  });

  resetBtn?.addEventListener("click", () => {
    if (!colorTarget) return;
    const { type, el } = colorTarget;
    if (type === "banana") {
      pickerApi.setHsv(DEFAULT_POSTER_HSV);
      return;
    }
    if (type === "sticker") {
      delete el.dataset.stickerTint;
      delete el.dataset.stickerH;
      delete el.dataset.stickerS;
      delete el.dataset.stickerV;
      const img = el.querySelector(".placed-sticker-img");
      if (img && el.dataset.stickerSrc) img.src = el.dataset.stickerSrc;
      pickerApi.setHsv(DEFAULT_POSTER_HSV);
      return;
    }
    if (type === "shape") {
      const hsv = hexToHsv(DEFAULT_SHAPE_FILL);
      pickerApi.setHsv(hsv);
    }
  });

  setDockVisible(false);

  return {
    readDefaultForNewBanana: () => ({ ...DEFAULT_POSTER_HSV }),
  };
}