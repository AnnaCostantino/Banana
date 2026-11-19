const SNAP_DEG = 15;

function clampDeg(deg) {
  let d = ((deg % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function rotationFor(el) {
  const v = parseFloat(el?.dataset.rotation ?? "0");
  return Number.isFinite(v) ? v : 0;
}

export function applyRotation(el, degrees) {
  const rot = clampDeg(degrees);
  el.dataset.rotation = String(rot);
  el.style.setProperty("--placed-rotate", `${rot.toFixed(2)}deg`);
}

export function createRotationHandle() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rotation-handle";
  btn.setAttribute("aria-label", "Rotate");
  return btn;
}

function elementCenterScreen(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pointerAngleDeg(cx, cy, px, py) {
  return (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
}

let rotateDrag = null;

function onRotatePointerMove(event) {
  if (!rotateDrag || rotateDrag.pointerId !== event.pointerId) return;
  const { cx, cy, startRot, startPointerAngle } = rotateDrag;
  const angle = pointerAngleDeg(cx, cy, event.clientX, event.clientY);
  let next = startRot + (angle - startPointerAngle);
  if (event.shiftKey) {
    next = Math.round(next / SNAP_DEG) * SNAP_DEG;
  }
  applyRotation(rotateDrag.el, next);
  rotateDrag.onChange?.(rotateDrag.el);
}

function onRotatePointerUp(event) {
  if (!rotateDrag || rotateDrag.pointerId !== event.pointerId) return;
  rotateDrag = null;
}

window.addEventListener("pointermove", onRotatePointerMove);
window.addEventListener("pointerup", onRotatePointerUp);
window.addEventListener("pointercancel", onRotatePointerUp);

export function bindRotationHandle(el, handle, options = {}) {
  handle.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    options.onSelect?.(el);
    const { x: cx, y: cy } = elementCenterScreen(el);
    const startRot = rotationFor(el);
    const startPointerAngle = pointerAngleDeg(cx, cy, event.clientX, event.clientY);
    rotateDrag = {
      el,
      pointerId: event.pointerId,
      cx,
      cy,
      startRot,
      startPointerAngle,
      onChange: options.onChange,
    };
  });
}