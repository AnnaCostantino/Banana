const FRAME_COUNT = 31;

const bananaEl = document.getElementById("banana");
const canvasEl = document.getElementById("canvas");
const layerEl = document.getElementById("sticker-layer");
const libraryEl = document.getElementById("sticker-library");
const minusBtn = document.getElementById("bruise-minus");
const plusBtn = document.getElementById("bruise-plus");

let bruiseIndex = 0;
let assets = { frames: [], stickers: [] };
let dragState = null;
let selectedSticker = null;

function frameSrc(index) {
  return assets.frames[index] || `./frames/banana-${String(index).padStart(2, "0")}.png`;
}

function setBruise(next) {
  bruiseIndex = Math.max(0, Math.min(FRAME_COUNT - 1, next));
  bananaEl.src = frameSrc(bruiseIndex);
  minusBtn.disabled = bruiseIndex <= 0;
  plusBtn.disabled = bruiseIndex >= FRAME_COUNT - 1;
}

function preloadFrames() {
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const img = new Image();
    img.src = frameSrc(i);
  }
}

function selectSticker(el) {
  if (selectedSticker === el) return;
  if (selectedSticker) selectedSticker.classList.remove("is-selected");
  selectedSticker = el;
  if (selectedSticker) {
    selectedSticker.classList.add("is-selected");
    selectedSticker.focus({ preventScroll: true });
  }
}

function removeSticker(el) {
  if (!el) return;
  if (selectedSticker === el) selectedSticker = null;
  if (dragState?.el === el) dragState = null;
  el.remove();
}

function placeSticker(src, clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 100;
  const y = ((clientY - rect.top) / rect.height) * 100;
  const left = clamp(x, 6, 94);
  const top = clamp(y, 8, 92);

  const wrapper = document.createElement("div");
  wrapper.className = "placed-sticker";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "button");
  wrapper.setAttribute("aria-label", "Placed sticker. Press Delete to remove.");
  wrapper.style.left = `${left}%`;
  wrapper.style.top = `${top}%`;
  wrapper.dataset.x = String(left);
  wrapper.dataset.y = String(top);

  const img = document.createElement("img");
  img.className = "placed-sticker-img";
  img.src = src;
  img.alt = "Placed sticker";
  img.draggable = false;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "sticker-remove";
  removeBtn.setAttribute("aria-label", "Remove sticker");
  removeBtn.innerHTML = "<span aria-hidden=\"true\">×</span>";
  removeBtn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  removeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeSticker(wrapper);
  });

  wrapper.appendChild(img);
  wrapper.appendChild(removeBtn);
  layerEl.appendChild(wrapper);
  bindPlacedDrag(wrapper);
  selectSticker(wrapper);
  return wrapper;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function bindPlacedDrag(el) {
  const onPointerDown = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (event.target.closest(".sticker-remove")) return;
    event.preventDefault();
    selectSticker(el);
    el.setPointerCapture(event.pointerId);
    el.classList.add("is-dragging");
    dragState = {
      el,
      pointerId: event.pointerId,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const onPointerMove = (event) => {
    if (!dragState || dragState.el !== el || dragState.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.moved && dx * dx + dy * dy > 9) dragState.moved = true;
    const rect = canvasEl.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 4, 96);
    const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 4, 96);
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.dataset.x = String(x);
    el.dataset.y = String(y);
  };

  const onPointerUp = (event) => {
    if (!dragState || dragState.el !== el || dragState.pointerId !== event.pointerId) return;
    el.classList.remove("is-dragging");
    dragState = null;
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
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
          ghost.style.left = `${ev.clientX - 40}px`;
          ghost.style.top = `${ev.clientY - 40}px`;
          ghost.style.width = "80px";
          ghost.style.height = "80px";
          ghost.style.opacity = "0.9";
          ghost.style.pointerEvents = "none";
          ghost.style.zIndex = "1000";
          document.body.appendChild(ghost);
        }
        if (ghost) {
          ghost.style.left = `${ev.clientX - 40}px`;
          ghost.style.top = `${ev.clientY - 40}px`;
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
          if (over) placeSticker(sticker.src, ev.clientX, ev.clientY);
          return;
        }

        // Click: drop near center of banana
        placeSticker(
          sticker.src,
          rect.left + rect.width * (0.45 + Math.random() * 0.2),
          rect.top + rect.height * (0.4 + Math.random() * 0.25)
        );
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });

    libraryEl.appendChild(button);
  });
}

minusBtn.addEventListener("click", () => setBruise(bruiseIndex - 1));
plusBtn.addEventListener("click", () => setBruise(bruiseIndex + 1));

canvasEl.addEventListener("pointerdown", (event) => {
  if (event.target === canvasEl || event.target === bananaEl || event.target === layerEl) {
    selectSticker(null);
  }
});

document.addEventListener("keydown", (event) => {
  if (!selectedSticker) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSticker(selectedSticker);
  }
  if (event.key === "Escape") {
    event.preventDefault();
    selectSticker(null);
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
        { id: "karla-mexico", src: "./stickers/karla-mexico.png", label: "Karla Bananas Mexico" },
        { id: "del-monte-basketball", src: "./stickers/del-monte-basketball.png", label: "Del Monte Basketball" },
        { id: "dole-sunburst", src: "./stickers/dole-sunburst.png", label: "Dole Sunburst" },
        { id: "chiquita-holidays", src: "./stickers/chiquita-holidays.png", label: "Chiquita Holidays" },
      ],
    };
  }

  // Normalize relative paths
  assets.frames = assets.frames.map((f) => (f.startsWith("./") ? f : `./${f}`));
  assets.stickers = assets.stickers.map((s) => ({
    ...s,
    src: s.src.startsWith("./") ? s.src : `./${s.src}`,
  }));

  renderLibrary(assets.stickers);
  setBruise(12);
  preloadFrames();
}

boot();
