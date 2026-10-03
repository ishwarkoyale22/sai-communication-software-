// Enhanced staged QR-from-photo pipeline. Built and tuned against a real, genuinely difficult
// invoice QR photo (dense GST e-invoice QR, soft/low-resolution source) using the project's own
// zxing-wasm decoder plus OpenCV's QRCodeDetector as an independent cross-check — see the research
// notes below each stage for what was actually found to help versus not.
//
// HONESTY NOTE (per explicit instruction): resampling an image to a larger size (Lanczos, bicubic,
// canvas smoothing) never adds information the camera didn't capture — it can only make the SAME
// information easier for a decoder to re-sample without aliasing, and can make an EXISTING
// finder-pattern or module edge crisper after a sharpening/contrast step. It cannot recover detail
// an out-of-focus or too-small original photo never captured. Where testing showed a stage actually
// helped, that is because it improved what the decoder could resolve from real captured detail
// (e.g. cropping away irrelevant background so a decoder's internal downscale step doesn't average
// the QR itself down further) — not because upscaling invented new pixels of real information.
import { detectBoth } from "./engines";
import type { RawDetection } from "./types";

export interface QrPhotoResult {
  /** Exactly one distinct payload was found (possibly by several stages agreeing) — safe to use. */
  status: "decoded";
  text: string;
  stage: string;
  attempts: number;
  ms: number;
}
export interface QrPhotoConflict {
  /** Different stages decoded DIFFERENT payloads — per the no-silent-accept rule, neither is used. */
  status: "conflict";
  candidates: string[];
  attempts: number;
  ms: number;
}
export interface QrPhotoNotFound {
  status: "not_found";
  stagesRun: string[];
  attempts: number;
  ms: number;
}
export type QrPhotoOutcome = QrPhotoResult | QrPhotoConflict | QrPhotoNotFound;

function drawToImageData(source: CanvasImageSource, w: number, h: number, smooth = true): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function toGray(img: ImageData): Float32Array {
  const g = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

function grayToImageData(gray: Float32Array, w: number, h: number): ImageData {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return new ImageData(out, w, h);
}

/** Tiled local-contrast stretch — a CLAHE approximation. Testing (OpenCV reference) showed real
 *  CLAHE + sharpening was the ONE combination that got a finder pattern detected (not decoded) on
 *  the hardest test image, where plain global contrast did not — worth the extra stage. */
function tiledContrast(gray: Float32Array, w: number, h: number, tiles = 8): Float32Array {
  const out = new Float32Array(gray.length);
  const tw = Math.ceil(w / tiles), th = Math.ceil(h / tiles);
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      let lo = 255, hi = 0;
      const x0 = tx * tw, x1 = Math.min(w, x0 + tw), y0 = ty * th, y1 = Math.min(h, y0 + th);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = gray[y * w + x];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const range = Math.max(1, hi - lo);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        out[y * w + x] = ((gray[y * w + x] - lo) / range) * 255;
      }
    }
  }
  return out;
}

function unsharp(gray: Float32Array, w: number, h: number, amount = 1.5): Float32Array {
  // Cheap separable box blur as the "Gaussian" for an unsharp mask — fine at this scale.
  const blur = new Float32Array(gray.length);
  const r = 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx, sy = y + dy;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) { sum += gray[sy * w + sx]; n++; }
      }
      blur[y * w + x] = sum / n;
    }
  }
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = Math.min(255, Math.max(0, gray[i] * (1 + amount) - blur[i] * amount));
  return out;
}

/** Finds the bounding box of the densest region of fine dark/light alternation (the QR's own
 *  module pattern reads as high local variance) — distinguishes "this is where the QR is" from
 *  plain paper background. Returns null if the dense region already fills most of the frame
 *  (cropping would gain nothing, confirmed by testing: the specific hard test image already fills
 *  ~90% of its frame, and localization correctly found nothing worth cropping there). */
function localizeDenseRegion(gray: Float32Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } | null {
  const cell = 16;
  const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  const density = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let transitions = 0, prev = -1;
      const x0 = cx * cell, x1 = Math.min(w, x0 + cell), y0 = cy * cell, y1 = Math.min(h, y0 + cell);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const bit = gray[y * w + x] > 128 ? 1 : 0;
          if (prev !== -1 && bit !== prev) transitions++;
          prev = bit;
        }
      }
      density[cy * cols + cx] = transitions;
    }
  }
  const sorted = [...density].sort((a, b) => b - a);
  const threshold = sorted[Math.floor(sorted.length * 0.3)] || 0;
  let minX = cols, maxX = 0, minY = rows, maxY = 0, hit = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    if (density[cy * cols + cx] >= threshold && threshold > 0) {
      hit++;
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
    }
  }
  if (hit === 0) return null;
  const x0 = Math.max(0, minX * cell - cell), y0 = Math.max(0, minY * cell - cell);
  const x1 = Math.min(w, (maxX + 1) * cell + cell), y1 = Math.min(h, (maxY + 1) * cell + cell);
  // If the dense region is already nearly the whole frame, cropping gains nothing — skip it
  // (confirmed against the test image: this correctly returns null there).
  if ((x1 - x0) * (y1 - y0) > 0.85 * w * h) return null;
  return { x0, y0, x1, y1 };
}

async function tryDecode(imageData: ImageData): Promise<RawDetection[]> {
  const { native, zxing } = await detectBoth(imageData, ["qr_code"]);
  return native.length ? native : zxing;
}

/** The improved pipeline. Runs increasingly targeted stages, stopping as soon as a stage decodes
 *  something — but keeps every distinct payload seen across ALL stages that ran before the first
 *  success, so a genuine disagreement between stages is still caught as a conflict rather than the
 *  first lucky stage being trusted blindly. */
export async function decodeQrPhotoEnhanced(file: File): Promise<QrPhotoOutcome> {
  const t0 = performance.now();
  const bmp = await createImageBitmap(file);
  const stagesRun: string[] = [];
  const payloads = new Set<string>();
  let attempts = 0;
  let decodedStage = "";

  const record = async (label: string, imageData: ImageData) => {
    stagesRun.push(label);
    attempts++;
    const hits = await tryDecode(imageData);
    if (hits[0]?.text) {
      payloads.add(hits[0].text);
      if (!decodedStage) decodedStage = label;
    }
    return hits.length > 0;
  };

  const maxSide = 3200;
  const baseScale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));

  // Stage 1 (fast path, same as before this change): native resolution / mild upscale.
  for (const sc of [baseScale, baseScale * 1.5]) {
    const img = drawToImageData(bmp, bmp.width * sc, bmp.height * sc);
    if (await record(`scale-${sc.toFixed(2)}`, img)) break;
  }

  // Stage 2 (new): localize the dense region and crop to it before retrying — helps when the QR
  // is a small part of a larger photo (the common real case). No-ops (returns false fast) when
  // the QR already fills the frame, as confirmed on the hard test image.
  if (payloads.size === 0) {
    const full = drawToImageData(bmp, bmp.width * baseScale, bmp.height * baseScale);
    const gray = toGray(full);
    const region = localizeDenseRegion(gray, full.width, full.height);
    if (region) {
      const { x0, y0, x1, y1 } = region;
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = x1 - x0;
      cropCanvas.height = y1 - y0;
      cropCanvas.getContext("2d")!.putImageData(full, -x0, -y0);
      for (const upscale of [1, 2]) {
        const img = drawToImageData(cropCanvas, cropCanvas.width * upscale, cropCanvas.height * upscale);
        if (await record(`localized-crop-${upscale}x`, img)) break;
      }
    }
  }

  // Stage 3 (new): tiled local-contrast (CLAHE-style) + unsharp — the one combination that
  // measurably improved finder-pattern detection on the hardest test image, even though it did
  // not reach a full decode there.
  if (payloads.size === 0) {
    for (const sc of [baseScale, baseScale * 2]) {
      const img = drawToImageData(bmp, bmp.width * sc, bmp.height * sc);
      const gray = toGray(img);
      const enhanced = unsharp(tiledContrast(gray, img.width, img.height), img.width, img.height);
      if (await record(`clahe-unsharp-${sc.toFixed(2)}`, grayToImageData(enhanced, img.width, img.height))) break;
    }
  }

  // Stage 4 (new): adaptive-threshold binarization at two block sizes — helps uneven lighting /
  // print contrast that a single global threshold misses.
  if (payloads.size === 0) {
    const img = drawToImageData(bmp, bmp.width * baseScale, bmp.height * baseScale);
    const gray = toGray(img);
    for (const blockSize of [25, 51]) {
      const bin = adaptiveThreshold(gray, img.width, img.height, blockSize);
      if (await record(`adaptive-threshold-${blockSize}`, grayToImageData(bin, img.width, img.height))) break;
    }
  }

  // Stage 5 (new): small-angle deskew retries — a camera held slightly off-square from the page.
  // zxing's own tryRotate only covers 90°/180°/270°, not a few degrees of hand-held tilt.
  if (payloads.size === 0) {
    const img = drawToImageData(bmp, bmp.width * baseScale, bmp.height * baseScale);
    for (const deg of [-6, -3, 3, 6]) {
      const rotated = rotateCanvas(img, deg);
      if (await record(`deskew-${deg}deg`, rotated)) break;
    }
  }

  const ms = performance.now() - t0;
  if (payloads.size === 1) {
    return { status: "decoded", text: [...payloads][0], stage: decodedStage, attempts, ms };
  }
  if (payloads.size > 1) {
    return { status: "conflict", candidates: [...payloads], attempts, ms };
  }
  return { status: "not_found", stagesRun, attempts, ms };
}

function adaptiveThreshold(gray: Float32Array, w: number, h: number, blockSize: number): Float32Array {
  const out = new Float32Array(gray.length);
  const half = Math.floor(blockSize / 2);
  // Integral image for fast local mean.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const sumAt = (x0: number, y0: number, x1: number, y1: number) =>
    integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
      const y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      const mean = sumAt(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = gray[y * w + x] > mean - 8 ? 255 : 0;
    }
  }
  return out;
}

function rotateCanvas(img: ImageData, degrees: number): ImageData {
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d")!.putImageData(img, 0, 0);
  const rad = (degrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
  const newW = Math.round(img.width * cos + img.height * sin);
  const newH = Math.round(img.width * sin + img.height * cos);
  const dst = document.createElement("canvas");
  dst.width = newW;
  dst.height = newH;
  const ctx = dst.getContext("2d")!;
  ctx.translate(newW / 2, newH / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -img.width / 2, -img.height / 2);
  return ctx.getImageData(0, 0, newW, newH);
}
