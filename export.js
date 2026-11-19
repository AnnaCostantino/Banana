/** Poster native aspect (9813×12597). */
const POSTER_ASPECT = 9813 / 12597;
/** Fixed print width in inches (portrait poster). */
const PRINT_WIDTH_IN = 8;

function exportPixelSize(dpi) {
  const widthPx = Math.round(PRINT_WIDTH_IN * dpi);
  const heightPx = Math.round((PRINT_WIDTH_IN / POSTER_ASPECT) * dpi);
  return { widthPx, heightPx, widthIn: PRINT_WIDTH_IN, heightIn: PRINT_WIDTH_IN / POSTER_ASPECT };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function loadHtml2Canvas() {
  const mod = await import("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm");
  return mod.default;
}

async function loadJsPDF() {
  const mod = await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm");
  return mod.jsPDF;
}

export function describeExportMath(dpi) {
  const { widthPx, heightPx, widthIn, heightIn } = exportPixelSize(dpi);
  return {
    printWidthIn: widthIn,
    printHeightIn: heightIn,
    widthPx,
    heightPx,
    formula: `${PRINT_WIDTH_IN}\" × ${dpi} dpi → ${widthPx}px wide; height = width / (9813/12597) → ${heightPx}px`,
  };
}

/**
 * Rasterize #canvas at print resolution and download JPG or PDF.
 */
export async function exportCollage({ artboardEl, canvasEl, format, dpi, onPrepare, onRestore }) {
  const rasterRoot = artboardEl || canvasEl;
  if (!rasterRoot) throw new Error("Missing export root");

  const { widthPx, heightPx, widthIn, heightIn } = exportPixelSize(dpi);
  const layoutWidth = rasterRoot.offsetWidth || 1;
  const scale = widthPx / layoutWidth;

  onPrepare?.();

  try {
    const html2canvas = await loadHtml2Canvas();
    const raster = await html2canvas(rasterRoot, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: null,
      logging: false,
      imageTimeout: 0,
    });

  const jpegQuality = format === "pdf" ? 0.92 : 0.94;
  const dataUrl = raster.toDataURL("image/jpeg", jpegQuality);

  if (format === "jpg") {
    const bin = atob(dataUrl.split(",")[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    downloadBlob(new Blob([bytes], { type: "image/jpeg" }), "banana-collage.jpg");
    return { widthPx, heightPx, format: "jpg" };
  }

  const jsPDF = await loadJsPDF();
  const pdf = new jsPDF({
    orientation: heightIn >= widthIn ? "portrait" : "landscape",
    unit: "in",
    format: [widthIn, heightIn],
  });
  pdf.addImage(dataUrl, "JPEG", 0, 0, widthIn, heightIn);
  pdf.save("banana-collage.pdf");
  return { widthPx, heightPx, format: "pdf" };
  } finally {
    onRestore?.();
  }
}

export { POSTER_ASPECT, PRINT_WIDTH_IN, exportPixelSize };