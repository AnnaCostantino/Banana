import { initShapes, deselectShape } from "./shapes.js";
import { applyRotation, bindRotationHandle, createRotationHandle } from "./rotation.js";
import { exportCollage } from "./export.js";
import {
  applyBBox,
  bindBBoxElement,
  bboxFromCenter,
  clearBboxDragIf,
  createBBoxHandles,
  stickerPoseCenter,
} from "./bbox.js";

const FRAME_COUNT = 31;
const PLACE_SCALE_BOOST = 1.1;
const DEFAULT_BANANA_BRUISE = 12;
const POSTER_TEXTURE_SRC = "./textures/banana-poster-texture.jpg";

const textureEl = document.getElementById("poster-texture");
const canvasEl = document.getElementById("canvas");
const posterArtboardEl = document.getElementById("poster-artboard");
const bananaLayerEl = document.getElementById("banana-layer");
const shapeLayerEl = document.getElementById("shape-layer");
const layerEl = document.getElementById("sticker-layer");
const libraryEl = document.getElementById("sticker-library");
const bananaPlaceBtn = document.getElementById("banana-place");
const bananaToolPreview = document.getElementById("banana-tool-preview");
const inlineEl = document.getElementById("placed-inline");
const inlineBruiseRow = document.getElementById("placed-inline-bruise");
const inlineBruiseMinusBtn = document.getElementById("inline-bruise-minus");
const inlineBruisePlusBtn = document.getElementById("inline-bruise-plus");
const stickersPanelEl = document.getElementById("stickers-panel");
const stickersToggleBtn = document.getElementById("stickers-toggle");
const stickersTrayWrapEl = document.getElementById("stickers-tray-wrap");
const bananaPanelEl = document.getElementById("banana-panel");
const bananaToggleBtn = document.getElementById("banana-toggle");
const bananaTrayWrapEl = document.getElementById("banana-tray-wrap");

/** Gap between selection bottom edge and inline controls (screen px). */
const INLINE_CONTROLS_OFFSET_PX = 8;
const BANANA_PLACE_W_PCT = 24;
const BANANA_IMG_ASPECT = 1512 / 865;
const STICKER_PLACE_W_PCT = 12;

let assets = { frames: [], stickers: [] };
let selectedPlaced = null;
let stickersLibraryExpanded = false;
let bananaToolExpanded = false;
/** @type {ReturnType<typeof initShapes> | null} */
let shapesApi = null;

function setSideToolExpanded(panelEl, trayWrapEl, toggleBtn, expanded, expandedFlagRef) {
  if (panelEl) {
    panelEl.classList.toggle("is-collapsed", !expanded);
    panelEl.classList.toggle("is-expanded", expanded);
  }
  if (trayWrapEl) trayWrapEl.hidden = !expanded;
  if (toggleBtn) toggleBtn.setAttribute("aria-expanded", String(expanded));
  return expanded;
}

function setStickersLibraryExpanded(expanded) {
  stickersLibraryExpanded = setSideToolExpanded(
    stickersPanelEl,
    stickersTrayWrapEl,
    stickersToggleBtn,
    expanded,
    stickersLibraryExpanded
  );
}

function setBananaToolExpanded(expanded) {
  bananaToolExpanded = setSideToolExpanded(
    bananaPanelEl,
    bananaTrayWrapEl,
    bananaToggleBtn,
    expanded,
    bananaToolExpanded
  );
}

function frameSrc(index) {
  return assets.frames[index] || `./frames/banana-${String(index).padStart(2, "0")}.png`;
}

function preloadFrames() {
  const poster = new Image();
  poster.src = POSTER_TEXTURE_SRC;
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const img = new Image();
    img.src = frameSrc(i);
  }
}

function isBananaPlaced(el) {
  return el?.classList?.contains("placed-banana");
}

function bruiseIndexFor(el) {
  const v = parseInt(el?.dataset.bruiseIndex ?? String(DEFAULT_BANANA_BRUISE), 10);
  return Number.isFinite(v) ? v : DEFAULT_BANANA_BRUISE;
}

function setBananaBruise(el, next) {
  if (!isBananaPlaced(el)) return;
  const index = Math.max(0, Math.min(FRAME_COUNT - 1, next));
  el.dataset.bruiseIndex = String(index);
  const img = el.querySelector(".placed-banana-img");
  if (img) img.src = frameSrc(index);
  syncInlineUi();
}

function onPlacedBBoxUpdate(el) {
  if (!isBananaPlaced(el)) {
    const { x, y } = stickerPoseCenter(el);
    applyStickerPose(el, x, y);
  }
  if (selectedPlaced === el) positionInlineControls();
}

function bindPlacedBBox(el) {
  bindBBoxElement(el, {
    canvasEl,
    clamp,
    aspectLock: true,
    onSelect: () => selectPlaced(el),
    onUpdate: onPlacedBBoxUpdate,
  });
}

/** Pin inline controls under selection using canvas-local %. */
function positionInlineControls() {
  if (!inlineEl) return;
  if (!selectedPlaced) {
    inlineEl.hidden = true;
    return;
  }

  const canvasRect = canvasEl.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) {
    inlineEl.hidden = true;
    return;
  }

  const targetRect = selectedPlaced.getBoundingClientRect();
  const centerX =
    ((targetRect.left + targetRect.width / 2 - canvasRect.left) / canvasRect.width) * 100;
  const topY =
    ((targetRect.bottom - canvasRect.top + INLINE_CONTROLS_OFFSET_PX) / canvasRect.height) * 100;

  inlineEl.style.left = `${centerX}%`;
  inlineEl.style.top = `${topY}%`;
  inlineEl.hidden = false;
}

function syncInlineUi() {
  const show = Boolean(selectedPlaced);
  if (!show) {
    if (inlineEl) inlineEl.hidden = true;
    return;
  }

  const isBanana = isBananaPlaced(selectedPlaced);
  if (inlineBruiseRow) inlineBruiseRow.hidden = !isBanana;

  if (isBanana) {
    const bruise = bruiseIndexFor(selectedPlaced);
    if (inlineBruiseMinusBtn) inlineBruiseMinusBtn.disabled = bruise <= 0;
    if (inlineBruisePlusBtn) inlineBruisePlusBtn.disabled = bruise >= FRAME_COUNT - 1;
  }

  positionInlineControls();
}

function selectPlaced(el) {
  if (selectedPlaced === el) return;
  deselectShape();
  if (selectedPlaced) selectedPlaced.classList.remove("is-selected");
  selectedPlaced = el;
  if (selectedPlaced) {
    selectedPlaced.classList.add("is-selected");
    selectedPlaced.focus({ preventScroll: true });
  }
  syncInlineUi();
}

function removePlaced(el) {
  if (!el) return;
  if (selectedPlaced === el) selectedPlaced = null;
  clearBboxDragIf(el);
  el.remove();
  syncInlineUi();
}

function placeScaleBoostForSticker(sticker) {
  const boost = sticker?.placeScaleBoost;
  return typeof boost === "number" && boost > 1 ? boost : 1;
}

function attachRotationHandle(wrapper, onSync) {
  const handle = createRotationHandle();
  bindRotationHandle(wrapper, handle, {
    onSelect: () => selectPlaced(wrapper),
    onChange: onSync,
  });
  wrapper.appendChild(handle);
  applyRotation(wrapper, 0);
}

function createRemoveButton(wrapper, onRemove) {
  const remove = onRemove || (() => removePlaced(wrapper));
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "placed-remove";
  removeBtn.setAttribute("aria-label", "Remove");
  removeBtn.innerHTML = "<span aria-hidden=\"true\">×</span>";
  removeBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  removeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    remove();
  });
  return removeBtn;
}

function percentPositionFromClient(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  return { left: x, top: y };
}

function placeBanana(clientX, clientY, bruiseIndex = DEFAULT_BANANA_BRUISE) {
  const { left, top } = percentPositionFromClient(clientX, clientY);
  const w = BANANA_PLACE_W_PCT;
  const h = w / BANANA_IMG_ASPECT;
  const box = bboxFromCenter(left, top, w, h);

  const wrapper = document.createElement("div");
  wrapper.className = "placed-banana";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute(
    "aria-label",
    "Placed banana. Drag to move. Use handles to resize. Bruise inline. Press Delete to remove."
  );
  wrapper.dataset.x = String(box.x);
  wrapper.dataset.y = String(box.y);
  wrapper.dataset.w = String(box.w);
  wrapper.dataset.h = String(box.h);
  wrapper.dataset.aspect = String(BANANA_IMG_ASPECT);
  wrapper.dataset.bruiseIndex = String(bruiseIndex);

  const img = document.createElement("img");
  img.className = "placed-banana-img";
  img.src = frameSrc(bruiseIndex);
  img.alt = "Placed banana";
  img.draggable = false;
  img.width = 1512;
  img.height = 865;

  wrapper.appendChild(img);
  wrapper.appendChild(createBBoxHandles());
  attachRotationHandle(wrapper, () => {
    positionInlineControls();
  });
  wrapper.appendChild(createRemoveButton(wrapper));
  applyBBox(wrapper);
  bananaLayerEl.appendChild(wrapper);
  bindPlacedBBox(wrapper);
  selectPlaced(wrapper);
  return wrapper;
}

function placeSticker(src, clientX, clientY, placeScaleBoost = 1) {
  const { left, top } = percentPositionFromClient(clientX, clientY);
  const w = STICKER_PLACE_W_PCT * placeScaleBoost;
  let h = w;
  const box = bboxFromCenter(left, top, w, h);

  const wrapper = document.createElement("div");
  wrapper.className = "placed-sticker";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute(
    "aria-label",
    "Placed sticker. Drag to move. Use handles to resize. Press Delete to remove."
  );
  wrapper.dataset.x = String(box.x);
  wrapper.dataset.y = String(box.y);
  wrapper.dataset.w = String(box.w);
  wrapper.dataset.h = String(box.h);
  wrapper.dataset.aspect = "1";
  wrapper.dataset.placeScaleBoost = String(placeScaleBoost);

  const img = document.createElement("img");
  img.className = "placed-sticker-img";
  img.src = src;
  img.alt = "Placed sticker";
  img.draggable = false;

  const syncStickerAspect = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const aspect = img.naturalWidth / img.naturalHeight;
    wrapper.dataset.aspect = String(aspect);
    const curW = parseFloat(wrapper.dataset.w);
    wrapper.dataset.h = String(curW / aspect);
    applyBBox(wrapper);
    onPlacedBBoxUpdate(wrapper);
  };
  img.addEventListener("load", syncStickerAspect);
  if (img.complete) syncStickerAspect();

  const { x, y } = stickerPoseCenter(wrapper);
  applyStickerPose(wrapper, x, y);

  wrapper.appendChild(img);
  wrapper.appendChild(createBBoxHandles());
  attachRotationHandle(wrapper, () => {
    positionInlineControls();
  });
  wrapper.appendChild(createRemoveButton(wrapper));
  applyBBox(wrapper);
  layerEl.appendChild(wrapper);
  bindPlacedBBox(wrapper);
  selectPlaced(wrapper);
  return wrapper;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Subtle curve + jitter so stickers read as stuck on the poster, not flat overlays. */
function applyStickerPose(el, xPercent, yPercent) {
  let jitter = parseFloat(el.dataset.jitter || "");
  if (Number.isNaN(jitter)) {
    jitter = (Math.random() - 0.5) * 8;
    el.dataset.jitter = String(jitter);
  }
  const rotateZ = clamp((xPercent - 50) * 0.32 + jitter, -12, 12);
  const rotateY = clamp((xPercent - 50) * 0.22, -9, 9);
  const skewX = clamp((yPercent - 50) * 0.14, -7, 7);
  el.style.setProperty("--sticker-rz", `${rotateZ.toFixed(2)}deg`);
  el.style.setProperty("--sticker-ry", `${rotateY.toFixed(2)}deg`);
  el.style.setProperty("--sticker-skew", `${skewX.toFixed(2)}deg`);
}

function bindLibraryPlaceThumb(button, onPlace) {
  button.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    let dragged = false;
    let ghost = null;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged && dx * dx + dy * dy > 36) {
        dragged = true;
        ghost = button.cloneNode(true);
        ghost.style.position = "fixed";
        const ghostSize = 96;
        ghost.style.left = `${ev.clientX - ghostSize / 2}px`;
        ghost.style.top = `${ev.clientY - ghostSize / 2}px`;
        ghost.style.width = `${ghostSize}px`;
        ghost.style.height = `${ghostSize}px`;
        ghost.style.opacity = "0.9";
        ghost.style.pointerEvents = "none";
        ghost.style.zIndex = "1000";
        document.body.appendChild(ghost);
      }
      if (ghost) {
        const ghostW = parseFloat(ghost.style.width) || 96;
        ghost.style.left = `${ev.clientX - ghostW / 2}px`;
        ghost.style.top = `${ev.clientY - ghostW / 2}px`;
      }
    };

    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (ghost) ghost.remove();

      const rect = canvasEl.getBoundingClientRect();
      if (dragged) {
        const over =
          ev.clientX >= rect.left &&
          ev.clientX <= rect.right &&
          ev.clientY >= rect.top &&
          ev.clientY <= rect.bottom;
        if (over) onPlace(ev.clientX, ev.clientY);
        return;
      }

      onPlace(
        rect.left + rect.width * (0.45 + Math.random() * 0.1),
        rect.top + rect.height * (0.42 + Math.random() * 0.12)
      );
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function renderLibrary(stickers) {
  libraryEl.replaceChildren();

  stickers.forEach((sticker) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sticker-thumb";
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `Add ${sticker.label}`);
    button.dataset.src = sticker.src;

    const img = document.createElement("img");
    img.src = sticker.src;
    img.alt = sticker.label;
    img.draggable = false;
    button.appendChild(img);

    bindLibraryPlaceThumb(button, (clientX, clientY) => {
      placeSticker(sticker.src, clientX, clientY, placeScaleBoostForSticker(sticker));
    });

    libraryEl.appendChild(button);
  });
}

let exportPanelExpanded = false;

function setExportPanelExpanded(expanded) {
  exportPanelExpanded = expanded;
  const panel = document.getElementById("export-panel");
  const wrap = document.getElementById("export-tray-wrap");
  const toggle = document.getElementById("export-toggle");
  if (panel) {
    panel.classList.toggle("is-collapsed", !expanded);
    panel.classList.toggle("is-expanded", expanded);
  }
  if (wrap) wrap.hidden = !expanded;
  if (toggle) toggle.setAttribute("aria-expanded", String(expanded));
}

stickersToggleBtn?.addEventListener("click", () => {
  setStickersLibraryExpanded(!stickersLibraryExpanded);
});
bananaToggleBtn?.addEventListener("click", () => {
  setBananaToolExpanded(!bananaToolExpanded);
});
document.getElementById("export-toggle")?.addEventListener("click", () => {
  setExportPanelExpanded(!exportPanelExpanded);
});

const exportDownloadBtn = document.getElementById("export-download");
exportDownloadBtn?.addEventListener("click", async () => {
  const formatEl = document.getElementById("export-format");
  const dpiEl = document.getElementById("export-dpi");
  const format = formatEl?.value === "pdf" ? "pdf" : "jpg";
  const dpi = parseInt(dpiEl?.value ?? "300", 10);
  exportDownloadBtn.disabled = true;
  exportDownloadBtn.textContent = "Exporting…";
  try {
    await exportCollage({
      artboardEl: posterArtboardEl,
      canvasEl,
      format,
      dpi,
      onPrepare: () => {
        selectPlaced(null);
        deselectShape();
        canvasEl.classList.add("is-exporting");
      },
      onRestore: () => {
        canvasEl.classList.remove("is-exporting");
      },
    });
  } catch (err) {
    console.error(err);
    window.alert("Export failed. Check your connection and try again.");
  } finally {
    exportDownloadBtn.disabled = false;
    exportDownloadBtn.textContent = "Download collage";
  }
});

inlineBruiseMinusBtn?.addEventListener("click", () => {
  if (selectedPlaced && isBananaPlaced(selectedPlaced)) {
    setBananaBruise(selectedPlaced, bruiseIndexFor(selectedPlaced) - 1);
  }
});
inlineBruisePlusBtn?.addEventListener("click", () => {
  if (selectedPlaced && isBananaPlaced(selectedPlaced)) {
    setBananaBruise(selectedPlaced, bruiseIndexFor(selectedPlaced) + 1);
  }
});
inlineEl?.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
});

canvasEl.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".placed-inline")) return;
  if (event.target.closest(".shape-color-picker")) return;
  if (shapesApi?.onCanvasPointerDown(event.target)) return;
  if (
    event.target === canvasEl ||
    event.target === textureEl ||
    event.target === bananaLayerEl ||
    event.target === shapeLayerEl ||
    event.target === layerEl
  ) {
    selectPlaced(null);
    deselectShape();
  }
});

window.addEventListener("resize", () => positionInlineControls());
if (typeof ResizeObserver !== "undefined" && canvasEl) {
  const canvasResizeObserver = new ResizeObserver(() => {
    positionInlineControls();
    shapesApi?.positionColorPicker?.();
  });
  canvasResizeObserver.observe(canvasEl);
}

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (shapesApi?.onKeydown(event)) return;
  if (!selectedPlaced) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removePlaced(selectedPlaced);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    selectPlaced(null);
  }
});

async function boot() {
  try {
    const res = await fetch("./assets.json");
    assets = await res.json();
  } catch {
    assets = {
      frames: Array.from({ length: FRAME_COUNT }, (_, i) =>
        `./frames/banana-${String(i).padStart(2, "0")}.png`
      ),
      stickers: [
        { id: "del-monte-guatemala", src: "./stickers/del-monte-guatemala.png", label: "Del Monte Guatemala" },
        { id: "chiquita-ecuador", src: "./stickers/chiquita-ecuador.png", label: "Chiquita Ecuador" },
        { id: "dole-colombia", src: "./stickers/dole-colombia.png", label: "Dole Colombia" },
        { id: "fyffes-jamaica", src: "./stickers/fyffes-jamaica.png", label: "Fyffes Jamaica" },
        {
          id: "karla-mexico",
          src: "./stickers/karla-mexico.png",
          label: "Karla Bananas Mexico",
          placeScaleBoost: PLACE_SCALE_BOOST,
        },
        {
          id: "del-monte-basketball",
          src: "./stickers/del-monte-basketball.png",
          label: "Del Monte Basketball",
          placeScaleBoost: PLACE_SCALE_BOOST,
        },
        { id: "dole-sunburst", src: "./stickers/dole-sunburst.png", label: "Dole Sunburst" },
        {
          id: "chiquita-holidays",
          src: "./stickers/chiquita-holidays.png",
          label: "Chiquita Holidays",
          placeScaleBoost: PLACE_SCALE_BOOST,
        },
      ],
    };
  }

  assets.frames = assets.frames.map((f) => (f.startsWith("./") ? f : `./${f}`));
  assets.stickers = assets.stickers.map((s) => ({
    ...s,
    src: s.src.startsWith("./") ? s.src : `./${s.src}`,
  }));

  if (bananaToolPreview) {
    bananaToolPreview.src = frameSrc(DEFAULT_BANANA_BRUISE);
  }

  renderLibrary(assets.stickers);
  setStickersLibraryExpanded(false);
  setBananaToolExpanded(false);
  setExportPanelExpanded(false);

  if (bananaPlaceBtn) {
    bindLibraryPlaceThumb(bananaPlaceBtn, (clientX, clientY) => {
      placeBanana(clientX, clientY, DEFAULT_BANANA_BRUISE);
    });
  }

  shapesApi = initShapes({
    canvasEl,
    shapeLayerEl,
    shapesPanelEl: document.getElementById("shapes-panel"),
    shapesToggleBtn: document.getElementById("shapes-toggle"),
    shapesTrayWrapEl: document.getElementById("shapes-tray-wrap"),
    shapesLibraryEl: document.getElementById("shape-library"),
    colorPickerEl: document.getElementById("shape-color-picker"),
    hsvSvEl: document.getElementById("hsv-sv"),
    hsvHueEl: document.getElementById("hsv-hue"),
    hsvSvPointer: document.getElementById("hsv-sv-pointer"),
    hsvHuePointer: document.getElementById("hsv-hue-pointer"),
    clamp,
    bindLibraryPlaceThumb,
    createRemoveButton,
    clearOtherSelection: () => selectPlaced(null),
    hideInlineForShape: () => {
      if (inlineEl) inlineEl.hidden = true;
    },
    inlineOffsetPx: INLINE_CONTROLS_OFFSET_PX,
  });

  preloadFrames();
}

boot();