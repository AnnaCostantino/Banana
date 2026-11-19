/** Default poster paper yellow (~ #f4df3a). */
export const DEFAULT_POSTER_HSV = { h: 52.5, s: 0.93, v: 0.96 };

export function hsvToRgb(h, s, v) {
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

export function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToHsv(hex) {
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

export function hsvToHex(h, s, v) {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function updateSvPickerBackground(svEl, hue) {
  if (!svEl) return;
  const hueColor = `hsl(${hue} 100% 50%)`;
  svEl.style.background = `
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, ${hueColor})
  `;
}

export function syncHsvPickerPointers({ svPointer, huePointer, h, s, v }) {
  if (svPointer) {
    svPointer.style.left = `${s * 100}%`;
    svPointer.style.top = `${(1 - v) * 100}%`;
  }
  if (huePointer) {
    huePointer.style.top = `${(h / 360) * 100}%`;
  }
}

/**
 * @param {object} config
 * @param {HTMLElement} config.svEl
 * @param {HTMLElement} config.hueEl
 * @param {HTMLElement} [config.svPointer]
 * @param {HTMLElement} [config.huePointer]
 * @param {(n: number, lo?: number, hi?: number) => number} [config.clamp]
 * @param {{ h: number, s: number, v: number }} config.initial
 * @param {(hsv: { h: number, s: number, v: number }) => void} config.onChange
 * @param {HTMLElement} [config.stopPropagationEl]
 */
export function bindHsvPicker(config) {
  const clamp = config.clamp ?? ((n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n)));
  let hue = config.initial.h;
  let sat = config.initial.s;
  let val = config.initial.v;
  const { svEl, hueEl, svPointer, huePointer } = config;

  const emit = () => {
    config.onChange({ h: hue, s: sat, v: val });
  };

  const sync = () => {
    syncHsvPickerPointers({ svPointer, huePointer, h: hue, s: sat, v: val });
    updateSvPickerBackground(svEl, hue);
  };

  const setHsv = (next) => {
    if (typeof next.h === "number") hue = next.h;
    if (typeof next.s === "number") sat = next.s;
    if (typeof next.v === "number") val = next.v;
    sync();
    emit();
  };

  const pickSv = (event) => {
    const rect = svEl.getBoundingClientRect();
    sat = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    val = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    sync();
    emit();
  };

  const pickHue = (event) => {
    const rect = hueEl.getBoundingClientRect();
    hue = clamp(((event.clientY - rect.top) / rect.height) * 360, 0, 359.9);
    sync();
    emit();
  };

  sync();

  let svDrag = null;
  svEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    svDrag = event.pointerId;
    svEl.setPointerCapture(event.pointerId);
    pickSv(event);
  });
  svEl.addEventListener("pointermove", (event) => {
    if (svDrag !== event.pointerId) return;
    pickSv(event);
  });
  svEl.addEventListener("pointerup", () => {
    svDrag = null;
  });

  let hueDrag = null;
  hueEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hueDrag = event.pointerId;
    hueEl.setPointerCapture(event.pointerId);
    pickHue(event);
  });
  hueEl.addEventListener("pointermove", (event) => {
    if (hueDrag !== event.pointerId) return;
    pickHue(event);
  });
  hueEl.addEventListener("pointerup", () => {
    hueDrag = null;
  });

  config.stopPropagationEl?.addEventListener("pointerdown", (event) => event.stopPropagation());

  return { setHsv, getHsv: () => ({ h: hue, s: sat, v: val }), sync };
}