import { applyRotation, bindRotationHandle, createRotationHandle } from "./rotation.js";

const SHAPE_TYPES = ["rectangle", "ellipse", "triangle"];
const DEFAULT_SHAPE_FILL = "#1055A8";
const MIN_SHAPE_PCT = 3;

/** @type {import('./shapes.js').ShapeApi | null} */
let api = null;
let selectedShape = null;
let shapeDragState = null;
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

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
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

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToHsv(hex) {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const num = parseInt(full, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function currentPickerColor() {
  const { r, g, b } = hsvToRgb(pickerHue, pickerSat, pickerVal);
  return rgbToHex(r, g, b);
}

function updateSvBackground() {
  if (!hsvSvEl) return;
  const hueColor = `hsl(${pickerHue} 100% 50%)`;
  hsvSvEl.style.background = `
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, ${hueColor})
  `;
}

function syncPickerPointers() {
  if (hsvSvPointer) {
    hsvSvPointer.style.left = `${pickerSat * 100}%`;
    hsvSvPointer.style.top = `${(1 - pickerVal) * 100}%`;
  }
  if (hsvHuePointer) {
    hsvHuePointer.style.top = `${(pickerHue / 360) * 100}%`;
  }
  updateSvBackground();
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

const HANDLE_IDS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function createHandleBox() {
  const box = document.createElement("div");
  box.className = "shape-handles";
  HANDLE_IDS.forEach((id) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `shape-handle shape-handle--${id}`;
    handle.dataset.handle = id;
    handle.setAttribute("aria-label", `Resize ${id}`);
    handle.addEventListener("pointerdown", (event) => startShapeResize(event, handle));
    box.appendChild(handle);
  });
  return box;
}

function applyShapeBox(el) {
  const w = parseFloat(el.dataset.w);
  const h = parseFloat(el.dataset.h);
  const x = parseFloat(el.dataset.x);
  const y = parseFloat(el.dataset.y);
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.style.width = `${w}%`;
  el.style.height = `${h}%`;
}

function placeShape(type, clientX, clientY) {
  const rect = api.canvasEl.getBoundingClientRect();
  const w = 22;
  const h = type === "rectangle" ? 14 : 18;
  let x = ((clientX - rect.left) / rect.width) * 100 - w / 2;
  let y = ((clientY - rect.top) / rect.height) * 100 - h / 2;
  x = api.clamp(x, 4, 96 - w);
  y = api.clamp(y, 4, 96 - h);

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
  if (shapeDragState?.el === el) shapeDragState = null;
  el.remove();
}

function startShapeMove(event, el) {
  if (event.button != null && event.button !== 0) return;
  if (event.target.closest(".shape-handle")) return;
  if (event.target.closest(".rotation-handle")) return;
  if (event.target.closest(".placed-remove")) return;
  event.preventDefault();
  selectShape(el);
  el.classList.add("is-dragging");
  shapeDragState = {
    mode: "move",
    el,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origX: parseFloat(el.dataset.x),
    origY: parseFloat(el.dataset.y),
  };
}

function startShapeResize(event, handle) {
  const el = handle.closest(".placed-shape");
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  selectShape(el);
  shapeDragState = {
    mode: "resize",
    el,
    pointerId: event.pointerId,
    handle: handle.dataset.handle,
    startX: event.clientX,
    startY: event.clientY,
    origX: parseFloat(el.dataset.x),
    origY: parseFloat(el.dataset.y),
    origW: parseFloat(el.dataset.w),
    origH: parseFloat(el.dataset.h),
    uniform: event.shiftKey,
  };
}

function onShapePointerMove(event) {
  if (!shapeDragState || shapeDragState.pointerId !== event.pointerId) return;
  const rect = api.canvasEl.getBoundingClientRect();
  const dxPct = ((event.clientX - shapeDragState.startX) / rect.width) * 100;
  const dyPct = ((event.clientY - shapeDragState.startY) / rect.height) * 100;
  const el = shapeDragState.el;

  if (shapeDragState.mode === "move") {
    const w = parseFloat(el.dataset.w);
    const h = parseFloat(el.dataset.h);
    const x = api.clamp(shapeDragState.origX + dxPct, 2, 98 - w);
    const y = api.clamp(shapeDragState.origY + dyPct, 2, 98 - h);
    el.dataset.x = String(x);
    el.dataset.y = String(y);
    applyShapeBox(el);
    positionColorPicker();
    return;
  }

  const { handle, origX, origY, origW, origH } = shapeDragState;
  let x = origX;
  let y = origY;
  let w = origW;
  let h = origH;
  const shift = event.shiftKey || shapeDragState.uniform;

  if (handle.includes("e")) w = Math.max(MIN_SHAPE_PCT, origW + dxPct);
  if (handle.includes("w")) {
    w = Math.max(MIN_SHAPE_PCT, origW - dxPct);
    x = origX + (origW - w);
  }
  if (handle.includes("s")) h = Math.max(MIN_SHAPE_PCT, origH + dyPct);
  if (handle.includes("n")) {
    h = Math.max(MIN_SHAPE_PCT, origH - dyPct);
    y = origY + (origH - h);
  }

  if (shift) {
    const avg = (w + h) / 2;
    w = avg;
    h = avg;
    if (handle.includes("w")) x = origX + origW - w;
    if (handle.includes("n")) y = origY + origH - h;
  }

  x = api.clamp(x, 2, 98 - w);
  y = api.clamp(y, 2, 98 - h);

  el.dataset.x = String(x);
  el.dataset.y = String(y);
  el.dataset.w = String(w);
  el.dataset.h = String(h);
  applyShapeBox(el);
  positionColorPicker();
}

function onShapePointerUp(event) {
  if (!shapeDragState || shapeDragState.pointerId !== event.pointerId) return;
  shapeDragState.el.classList.remove("is-dragging");
  shapeDragState = null;
}

function bindShapeInteractions(el) {
  el.addEventListener("pointerdown", (event) => startShapeMove(event, el));
}

window.addEventListener("pointermove", (event) => {
  if (shapeDragState) onShapePointerMove(event);
});

window.addEventListener("pointerup", (event) => {
  if (shapeDragState && shapeDragState.pointerId === event.pointerId) {
    onShapePointerUp(event);
  }
});

window.addEventListener("pointercancel", (event) => {
  if (shapeDragState && shapeDragState.pointerId === event.pointerId) {
    onShapePointerUp(event);
  }
});

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
  setPickerFromHex(DEFAULT_SHAPE_FILL);

  const pickSv = (event) => {
    const rect = hsvSvEl.getBoundingClientRect();
    pickerSat = api.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    pickerVal = api.clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    syncPickerPointers();
    applyPickerToSelectedShape();
  };

  const pickHue = (event) => {
    const rect = hsvHueEl.getBoundingClientRect();
    pickerHue = api.clamp(((event.clientY - rect.top) / rect.height) * 360, 0, 359.9);
    syncPickerPointers();
    applyPickerToSelectedShape();
  };

  let svDrag = null;
  hsvSvEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    svDrag = event.pointerId;
    hsvSvEl.setPointerCapture(event.pointerId);
    pickSv(event);
  });
  hsvSvEl.addEventListener("pointermove", (event) => {
    if (svDrag !== event.pointerId) return;
    pickSv(event);
  });
  hsvSvEl.addEventListener("pointerup", () => {
    svDrag = null;
  });

  let hueDrag = null;
  hsvHueEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hueDrag = event.pointerId;
    hsvHueEl.setPointerCapture(event.pointerId);
    pickHue(event);
  });
  hsvHueEl.addEventListener("pointermove", (event) => {
    if (hueDrag !== event.pointerId) return;
    pickHue(event);
  });
  hsvHueEl.addEventListener("pointerup", () => {
    hueDrag = null;
  });

  colorPickerEl?.addEventListener("pointerdown", (event) => event.stopPropagation());
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