import { applyRotation, bindRotationHandle, createRotationHandle } from "./rotation.js";
import {
  applyBBox as applyShapeBox,
  bindBBoxElement,
  clearBboxDragIf,
  createBBoxHandles as createHandleBox,
} from "./bbox.js";
import {
  bindHsvPicker,
  hexToHsv,
  hsvToRgb,
  rgbToHex,
  updateSvPickerBackground,
  syncHsvPickerPointers,
} from "./hsv-color.js";

const SHAPE_TYPES = ["rectangle", "ellipse", "triangle"];
const DEFAULT_SHAPE_FILL = "#1055A8";
/** @type {import('./shapes.js').ShapeApi | null} */
let api = null;
let selectedShape = null;
let shapesLibraryExpanded = false;

let shapeLayerEl;
let shapesPanelEl;
let shapesToggleBtn;
let shapesTrayWrapEl;
let shapesLibraryEl;
let colorPickerEl;
let hsvSvEl;
let hsvHueEl;
let hsvSvPointer;
let hsvHuePointer;

let pickerHue = 212;
let pickerSat = 0.72;
let pickerVal = 0.55;

function currentPickerColor() {
  const { r, g, b } = hsvToRgb(pickerHue, pickerSat, pickerVal);
  return rgbToHex(r, g, b);
}

function syncPickerPointers() {
  syncHsvPickerPointers({
    svPointer: hsvSvPointer,
    huePointer: hsvHuePointer,
    h: pickerHue,
    s: pickerSat,
    v: pickerVal,
  });
  updateSvPickerBackground(hsvSvEl, pickerHue);
}

function applyPickerToSelectedShape() {
  const hex = currentPickerColor();
  if (selectedShape) {
    selectedShape.dataset.fill = hex;
    const graphic = selectedShape.querySelector(".shape-graphic");
    if (graphic) graphic.style.color = hex;
  }
}

function setPickerFromHex(hex) {
  const hsv = hexToHsv(hex);
  pickerHue = hsv.h;
  pickerSat = hsv.s;
  pickerVal = hsv.v;
  syncPickerPointers();
}

function positionColorPicker() {
  if (!colorPickerEl || !selectedShape) {
    if (colorPickerEl) colorPickerEl.hidden = true;
    return;
  }
  const canvasRect = api.canvasEl.getBoundingClientRect();
  const shapeRect = selectedShape.getBoundingClientRect();
  const centerX =
    ((shapeRect.left + shapeRect.width / 2 - canvasRect.left) / canvasRect.width) * 100;
  const topY =
    ((shapeRect.bottom - canvasRect.top + api.inlineOffsetPx) / canvasRect.height) * 100;
  colorPickerEl.style.left = `${centerX}%`;
  colorPickerEl.style.top = `${topY}%`;
  colorPickerEl.hidden = false;
}

function isShapeEl(el) {
  return el?.classList?.contains("placed-shape");
}

export function deselectShape() {
  if (!selectedShape) return;
  selectedShape.classList.remove("is-selected");
  selectedShape = null;
  if (colorPickerEl) colorPickerEl.hidden = true;
}

export function selectShape(el) {
  if (selectedShape === el) return;
  api.clearOtherSelection();
  deselectShape();
  selectedShape = el;
  if (selectedShape) {
    selectedShape.classList.add("is-selected");
    selectedShape.focus({ preventScroll: true });
    setPickerFromHex(selectedShape.dataset.fill || DEFAULT_SHAPE_FILL);
    applyPickerToSelectedShape();
    positionColorPicker();
    api.hideInlineForShape?.();
  }
}

function shapeGraphicSvg(type) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "shape-graphic");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  if (type === "rectangle") {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("width", "100");
    rect.setAttribute("height", "100");
    svg.appendChild(rect);
  } else if (type === "ellipse") {
    const ellipse = document.createElementNS(ns, "ellipse");
    ellipse.setAttribute("cx", "50");
    ellipse.setAttribute("cy", "50");
    ellipse.setAttribute("rx", "50");
    ellipse.setAttribute("ry", "50");
    svg.appendChild(ellipse);
  } else {
    const poly = document.createElementNS(ns, "polygon");
    poly.setAttribute("points", "50,0 100,100 0,100");
    svg.appendChild(poly);
  }
  return svg;
}

function placeShape(type, clientX, clientY) {
  const rect = api.canvasEl.getBoundingClientRect();
  const w = 22;
  const h = type === "rectangle" ? 14 : 18;
  const x = ((clientX - rect.left) / rect.width) * 100 - w / 2;
  const y = ((clientY - rect.top) / rect.height) * 100 - h / 2;

  const wrapper = document.createElement("div");
  wrapper.className = "placed-shape";
  wrapper.tabIndex = 0;
  wrapper.dataset.shapeType = type;
  wrapper.dataset.x = String(x);
  wrapper.dataset.y = String(y);
  wrapper.dataset.w = String(w);
  wrapper.dataset.h = String(h);
  wrapper.dataset.fill = DEFAULT_SHAPE_FILL;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("aria-label", `Placed ${type}. Drag to move. Use handles to resize.`);

  const graphic = shapeGraphicSvg(type);
  graphic.style.color = DEFAULT_SHAPE_FILL;
  wrapper.appendChild(graphic);
  wrapper.appendChild(createHandleBox());
  const rotHandle = createRotationHandle();
  bindRotationHandle(wrapper, rotHandle, {
    onSelect: () => selectShape(wrapper),
    onChange: () => positionColorPicker(),
  });
  wrapper.appendChild(rotHandle);
  wrapper.appendChild(api.createRemoveButton(wrapper, () => removeShape(wrapper)));
  applyShapeBox(wrapper);
  applyRotation(wrapper, 0);

  shapeLayerEl.appendChild(wrapper);
  bindShapeInteractions(wrapper);
  selectShape(wrapper);
  return wrapper;
}

function removeShape(el) {
  if (!el) return;
  if (selectedShape === el) deselectShape();
  clearBboxDragIf(el);
  el.remove();
}

function bindShapeInteractions(el) {
  bindBBoxElement(el, {
    canvasEl: api.canvasEl,
    clamp: api.clamp,
    aspectLock: false,
    onSelect: () => selectShape(el),
    onUpdate: () => positionColorPicker(),
  });
}

function shapePreviewIcon(type) {
  const svg = shapeGraphicSvg(type);
  svg.setAttribute("class", "shape-preview-icon");
  return svg;
}

function renderShapeLibrary() {
  if (!shapesLibraryEl) return;
  shapesLibraryEl.replaceChildren();
  SHAPE_TYPES.forEach((type) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shape-thumb";
    button.setAttribute("aria-label", `Add ${type}`);
    button.appendChild(shapePreviewIcon(type));
    api.bindLibraryPlaceThumb(button, (clientX, clientY) => placeShape(type, clientX, clientY));
    shapesLibraryEl.appendChild(button);
  });
}

function setShapesLibraryExpanded(expanded) {
  shapesLibraryExpanded = expanded;
  if (shapesPanelEl) {
    shapesPanelEl.classList.toggle("is-collapsed", !expanded);
    shapesPanelEl.classList.toggle("is-expanded", expanded);
  }
  if (shapesTrayWrapEl) shapesTrayWrapEl.hidden = !expanded;
  if (shapesToggleBtn) shapesToggleBtn.setAttribute("aria-expanded", String(expanded));
}

function bindColorPicker() {
  if (!hsvSvEl || !hsvHueEl) return;
  bindHsvPicker({
    svEl: hsvSvEl,
    hueEl: hsvHueEl,
    svPointer: hsvSvPointer,
    huePointer: hsvHuePointer,
    clamp: api.clamp,
    initial: hexToHsv(DEFAULT_SHAPE_FILL),
    onChange: ({ h, s, v }) => {
      pickerHue = h;
      pickerSat = s;
      pickerVal = v;
      applyPickerToSelectedShape();
    },
    stopPropagationEl: colorPickerEl,
  });
}

export function initShapes(options) {
  api = options;
  shapeLayerEl = options.shapeLayerEl;
  shapesPanelEl = options.shapesPanelEl;
  shapesToggleBtn = options.shapesToggleBtn;
  shapesTrayWrapEl = options.shapesTrayWrapEl;
  shapesLibraryEl = options.shapesLibraryEl;
  colorPickerEl = options.colorPickerEl;
  hsvSvEl = options.hsvSvEl;
  hsvHueEl = options.hsvHueEl;
  hsvSvPointer = options.hsvSvPointer;
  hsvHuePointer = options.hsvHuePointer;

  shapesToggleBtn?.addEventListener("click", () => {
    setShapesLibraryExpanded(!shapesLibraryExpanded);
  });

  renderShapeLibrary();
  setShapesLibraryExpanded(false);
  bindColorPicker();

  window.addEventListener("resize", positionColorPicker);

  return {
    isShapeEl,
    selectShape,
    deselectShape,
    getSelectedShape: () => selectedShape,
    positionColorPicker,
    removeShape,
    onCanvasPointerDown(target) {
      if (target.closest?.(".shape-color-picker")) return true;
      if (target === shapeLayerEl) {
        deselectShape();
        return false;
      }
      return false;
    },
    onKeydown(event) {
      if (!selectedShape) return false;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeShape(selectedShape);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        deselectShape();
        api.clearOtherSelection();
        return true;
      }
      return false;
    },
  };
}