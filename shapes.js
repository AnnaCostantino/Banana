import { applyRotation, bindRotationHandle, createRotationHandle } from "./rotation.js";
import {
  applyBBox as applyShapeBox,
  bindBBoxElement,
  clearBboxDragIf,
  createBBoxHandles as createHandleBox,
} from "./bbox.js";
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

function isShapeEl(el) {
  return el?.classList?.contains("placed-shape");
}

export function deselectShape() {
  if (!selectedShape) return;
  selectedShape.classList.remove("is-selected");
  selectedShape = null;
  api.onShapeDeselected?.();
}

export function selectShape(el) {
  if (selectedShape === el) return;
  api.clearOtherSelection();
  deselectShape();
  selectedShape = el;
  if (selectedShape) {
    selectedShape.classList.add("is-selected");
    selectedShape.focus({ preventScroll: true });
    api.onShapeSelected?.(selectedShape);
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

function duplicateShapeFromSnapshot(snapshot) {
  const wrapper = document.createElement("div");
  wrapper.className = "placed-shape";
  wrapper.tabIndex = 0;
  wrapper.dataset.shapeType = snapshot.shapeType;
  wrapper.dataset.x = String(snapshot.x);
  wrapper.dataset.y = String(snapshot.y);
  wrapper.dataset.w = String(snapshot.w);
  wrapper.dataset.h = String(snapshot.h);
  wrapper.dataset.fill = snapshot.fill;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute(
    "aria-label",
    `Placed ${snapshot.shapeType}. Drag to move. Use handles to resize.`
  );

  const graphic = shapeGraphicSvg(snapshot.shapeType);
  graphic.style.color = snapshot.fill;
  wrapper.appendChild(graphic);
  wrapper.appendChild(createHandleBox());
  const rotHandle = createRotationHandle();
  bindRotationHandle(wrapper, rotHandle, {
    onSelect: () => selectShape(wrapper),
    onChange: () => {},
  });
  wrapper.appendChild(rotHandle);
  wrapper.appendChild(api.createRemoveButton(wrapper, () => removeShape(wrapper)));
  applyShapeBox(wrapper);
  applyRotation(wrapper, snapshot.rotation ?? 0);

  shapeLayerEl.appendChild(wrapper);
  bindShapeInteractions(wrapper);
  selectShape(wrapper);
  return wrapper;
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
    onChange: () => {},
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
    onUpdate: () => {},
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

export function initShapes(options) {
  api = options;
  shapeLayerEl = options.shapeLayerEl;
  shapesPanelEl = options.shapesPanelEl;
  shapesToggleBtn = options.shapesToggleBtn;
  shapesTrayWrapEl = options.shapesTrayWrapEl;
  shapesLibraryEl = options.shapesLibraryEl;

  shapesToggleBtn?.addEventListener("click", () => {
    setShapesLibraryExpanded(!shapesLibraryExpanded);
  });

  renderShapeLibrary();
  setShapesLibraryExpanded(false);

  return {
    isShapeEl,
    selectShape,
    deselectShape,
    getSelectedShape: () => selectedShape,
    removeShape,
    duplicateFromSnapshot: duplicateShapeFromSnapshot,
    onCanvasPointerDown(target) {
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