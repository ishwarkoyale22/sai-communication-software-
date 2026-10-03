// Staged photo decoding. A still photo can't use multi-FRAME verification (there's only one
// frame) — instead this stages increasingly expensive processing passes and requires agreement
// between independent passes/engines before presenting a result, per README.md "Photo scanning".
import { detectBoth } from "./engines";
import type { BarcodeFormat, RawDetection } from "./types";

export interface PhotoCandidate {
  text: string;
  format: BarcodeFormat;
  /** How many independent passes/engines produced this exact text — the photo-mode stand-in
   *  for live multi-frame verification. 1 means "seen once, present as unconfirmed". */
  agreement: number;
  point?: { x: number; y: number };
}

export interface StagedDecodeResult {
  /** Every distinct valid candidate found, strongest agreement first. Empty = nothing decoded
   *  at all after every stage ran. */
  candidates: PhotoCandidate[];
  stagesRun: string[];
}

function drawScaled(bmp: ImageBitmap, scale: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Grayscale + simple contrast stretch (min/max normalize), in place. */
function grayscaleContrast(img: ImageData): ImageData {
  const d = img.data;
  let lo = 255, hi = 0;
  const gray = new Uint8ClampedArray(d.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    gray[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = ((gray[i] - lo) / range) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  return img;
}

/** Simple 3x3 unsharp mask — cheap enough for one still image, never run on live video frames. */
function sharpen(img: ImageData): ImageData {
  const { width: w, height: h, data: src } = img;
  const out = new Uint8ClampedArray(src.length);
  const k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = Math.min(w - 1, Math.max(0, x + kx));
            const sy = Math.min(h - 1, Math.max(0, y + ky));
            sum += src[(sy * w + sx) * 4 + c] * k[(ky + 1) * 3 + (kx + 1)];
          }
        }
        out[(y * w + x) * 4 + c] = sum;
      }
      out[(y * w + x) * 4 + 3] = src[(y * w + x) * 4 + 3];
    }
  }
  return new ImageData(out, w, h);
}

function invert(img: ImageData): ImageData {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return new ImageData(d, img.width, img.height);
}

function mergeCandidates(all: RawDetection[][]): PhotoCandidate[] {
  const byText = new Map<string, PhotoCandidate>();
  for (const pass of all) {
    const seenThisPass = new Set<string>();
    for (const d of pass) {
      if (seenThisPass.has(d.text)) continue; // two engines on the same pass agreeing counts once per pass
      seenThisPass.add(d.text);
      const existing = byText.get(d.text);
      byText.set(d.text, { text: d.text, format: d.format, agreement: (existing?.agreement ?? 0) + 1, point: d.point ?? existing?.point });
    }
  }
  return [...byText.values()].sort((a, b) => b.agreement - a.agreement);
}

/** Runs the staged pipeline: normal scale → alternate scale → grayscale/contrast → sharpen →
 *  invert, STOPPING as soon as any pass yields a candidate with agreement >= 2 (i.e. confirmed
 *  by two independent passes or two engines on one pass) so the expensive later stages
 *  (sharpen, invert) only ever run on genuinely hard images, not on every photo. */
export async function decodeImageStaged(file: File, formats: BarcodeFormat[]): Promise<StagedDecodeResult> {
  const bmp = await createImageBitmap(file);
  const maxSide = 2800;
  const baseScale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));

  const stagesRun: string[] = [];
  const allHits: RawDetection[][] = [];

  const runStage = async (label: string, img: ImageData) => {
    stagesRun.push(label);
    const { native, zxing } = await detectBoth(img, formats);
    allHits.push(native, zxing);
    return mergeCandidates(allHits);
  };

  // Stage 1: normal scale, as-is.
  let candidates = await runStage("normal", drawScaled(bmp, baseScale));
  if (candidates.some((c) => c.agreement >= 2)) return { candidates, stagesRun };

  // Stage 2: alternate scale (half-size — helps with screen moiré / very dense codes).
  candidates = await runStage("alt-scale-0.5x", drawScaled(bmp, baseScale * 0.5));
  if (candidates.some((c) => c.agreement >= 2)) return { candidates, stagesRun };

  // Stage 3: grayscale + contrast stretch — helps low-contrast / washed-out photos.
  candidates = await runStage("grayscale-contrast", grayscaleContrast(drawScaled(bmp, baseScale)));
  if (candidates.some((c) => c.agreement >= 2)) return { candidates, stagesRun };

  // Stage 4: sharpen on top of the contrast-enhanced image — helps slight blur.
  candidates = await runStage("sharpen", sharpen(grayscaleContrast(drawScaled(bmp, baseScale))));
  if (candidates.some((c) => c.agreement >= 2)) return { candidates, stagesRun };

  // Stage 5: inverted — helps a light-on-dark barcode (some packaging prints this way).
  candidates = await runStage("invert", invert(drawScaled(bmp, baseScale)));
  return { candidates, stagesRun };
}
