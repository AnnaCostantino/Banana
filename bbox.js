export const MIN_BBOX_PCT = 3;
const CORNERS = new Set(["nw", "ne", "se", "sw"]);

export function applyBBox(el) {
  const w = parseFloat(el.dataset.w);
  const h = parseFloat(el.dataset.h);
  const x = parseFloat(el.dataset.x);
  const y = parseFloat(el.dataset.y);
  el.style.left = `${x}%`;
  el.style.top = `${y}%`;
  el.style.width = `${w}%`;
  el.style.height = `${h}%`;
}

export function createBBoxHandles() {
  const box = document.createElement("div");
  box.className = "shape-handles";
  ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((id) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `shape-handle shape-handle--${id}`;
    handle.dataset.handle = id;
    handle.setAttribute("aria-label", `Resize ${id}`);
    box.appendChild(handle);
  });
  return box;
}

function isCorner(handle) {
  return CORNERS.has(handle);
}

function applyAspectCornerResize(handle, aspect, origX, origY, origW, origH, dxPct, dyPct) {
  let newW = origW;
  let newH = origH;
  if (handle.includes("e")) newW = Math.max(MIN_BBOX_PCT, origW + dxPct);
  if (handle.includes("w")) newW = Math.max(MIN_BBOX_PCT, origW - dxPct);
  if (handle.includes("s")) newH = Math.max(MIN_BBOX_PCT, origH + dyPct);
  if (handle.includes("n")) newH = Math.max(MIN_BBOX_PCT, origH - dyPct);
  if (Math.abs(dxPct) >= Math.abs(dyPct)) {
    newH = newW / aspect;
  } else {
    newW = newH * aspect;
  }
  let x = origX;
  let y = origY;
  if (handle.includes("w")) x = origX + (origW - newW);
  if (handle.includes("n")) y = origY + (origH - newH);
  return { x, y, w: newW, h: newH };
}

let bboxDrag = null;

function onBboxPointerMove(event) {
  if (!bboxDrag || bboxDrag.pointerId !== event.pointerId) return;
  const { canvasEl, clamp, onUpdate } = bboxDrag;
  const rect = canvasEl.getBoundingClientRect();
  const dxPct = ((event.clientX - bboxDrag.startX) / rect.width) * 100;
  const dyPct = ((event.clientY - bboxDrag.startY) / rect.height) * 100;
  const el = bboxDrag.el;

  if (bboxDrag.mode === "move") {
    const w = parseFloat(el.dataset.w);
    const h = parseFloat(el.dataset.h);
    const x = clamp(bboxDrag.origX + dxPct, 2, 98 - w);
    const y = clamp(bboxDrag.origY + dyPct, 2, 98 - h);
    el.dataset.x = String(x);
    el.dataset.y = String(y);
    applyBBox(el);
    onUpdate?.(el);
    return;
  }

  const { handle, origX, origY, origW, origH, aspectLock } = bboxDrag;
  let x = origX;
  let y = origY;
  let w = origW;
  let h = origH;
  const shift = event.shiftKey || bboxDrag.uniform;

  if (aspectLock && isCorner(handle) && !shift) {
    const aspect = parseFloat(el.dataset.aspect) || origW / origH;
    const sized = applyAspectCornerResize(handle, aspect, origX, origY, origW, origH, dxPct, dyPct);
    x = sized.x;
    y = sized.y;
    w = sized.w;
    h = sized.h;
  } else {
    if (handle.includes("e")) w = Math.max(MIN_BBOX_PCT, origW + dxPct);
    if (handle.includes("w")) {
      w = Math.max(MIN_BBOX_PCT, origW - dxPct);
      x = origX + (origW - w);
    }
    if (handle.includes("s")) h = Math.max(MIN_BBOX_PCT, origH + dyPct);
    if (handle.includes("n")) {
      h = Math.max(MIN_BBOX_PCT, origH - dyPct);
      y = origY + (origH - h);
    }
    if (shift) {
      const avg = (w + h) / 2;
      w = avg;
      h = avg;
      if (handle.includes("w")) x = origX + origW - w;
      if (handle.includes("n")) y = origY + origH - h;
    }
  }

  x = clamp(x, 2, 98 - w);
  y = clamp(y, 2, 98 - h);
  el.dataset.x = String(x);
  el.dataset.y = String(y);
  el.dataset.w = String(w);
  el.dataset.h = String(h);
  applyBBox(el);
  onUpdate?.(el);
}

function endBboxDrag(event) {
  if (!bboxDrag || bboxDrag.pointerId !== event.pointerId) return;
  bboxDrag.el.classList.remove("is-dragging");
  bboxDrag = null;
}

function wireBboxHandleResize(handle, el, options) {
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onSelect?.(el);
    el.classList.add("is-dragging");
    bboxDrag = {
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
      aspectLock: options.aspectLock ?? false,
      canvasEl: options.canvasEl,
      clamp: options.clamp,
      onUpdate: options.onUpdate,
    };
  });
}

/** @param {HTMLElement} el @param {object} options */
export function bindBBoxElement(el, options) {
  el.querySelectorAll(".shape-handle").forEach((handle) => {
    wireBboxHandleResize(handle, el, options);
  });

  el.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest(".shape-handle")) return;
    if (event.target.closest(".rotation-handle")) return;
    if (event.target.closest(".placed-remove")) return;
  if (event.target.closest(".placed-inline")) return;
    event.preventDefault();
    options.onSelect?.(el);
    el.classList.add("is-dragging");
    bboxDrag = {
      mode: "move",
      el,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origX: parseFloat(el.dataset.x),
      origY: parseFloat(el.dataset.y),
      canvasEl: options.canvasEl,
      clamp: options.clamp,
      onUpdate: options.onUpdate,
    };
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("pointermove", onBboxPointerMove);
  window.addEventListener("pointerup", endBboxDrag);
  window.addEventListener("pointercancel", endBboxDrag);
}

export function bboxFromCenter(cx, cy, w, h, clamp) {
  const x = clamp(cx - w / 2, 2, 98 - w);
  const y = clamp(cy - h / 2, 2, 98 - h);
  return { x, y, w, h };
}

export function clearBboxDragIf(el) {
  if (bboxDrag?.el === el) {
    bboxDrag.el.classList.remove("is-dragging");
    bboxDrag = null;
  }
}

export function stickerPoseCenter(el) {
  const x = parseFloat(el.dataset.x) + parseFloat(el.dataset.w) / 2;
  const y = parseFloat(el.dataset.y) + parseFloat(el.dataset.h) / 2;
  return { x, y };
}