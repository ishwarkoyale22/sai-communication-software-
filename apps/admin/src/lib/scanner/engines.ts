// The two detection engines. Both built from what the project already depends on —
// no new package. Native is tried first when available (fast, Chromium-only); zxing-wasm
// runs everywhere (including iPhone Safari, which never has BarcodeDetector — see
// apps/admin/src/lib/scanner/README.md for the browser-support research this is based on).
import type { BarcodeFormat, DetectionEngine, RawDetection } from "./types";

// --- format name mapping ----------------------------------------------------------------
// Each engine names formats differently; this app's own BarcodeFormat is the common currency.
const NATIVE_FORMAT: Record<BarcodeFormat, string> = {
  qr_code: "qr_code",
  code_128: "code_128",
  code_39: "code_39",
  ean_13: "ean_13",
  ean_8: "ean_8",
  upc_a: "upc_a",
  upc_e: "upc_e",
  itf: "itf",
};
const fromNativeFormat = (s: string): BarcodeFormat | undefined =>
  (Object.entries(NATIVE_FORMAT).find(([, v]) => v === s)?.[0] as BarcodeFormat) ?? undefined;

const ZXING_FORMAT: Record<BarcodeFormat, string> = {
  qr_code: "QRCode",
  code_128: "Code128",
  code_39: "Code39",
  ean_13: "EAN-13",
  ean_8: "EAN-8",
  upc_a: "UPC-A",
  upc_e: "UPC-E",
  itf: "ITF",
};
const fromZxingFormat = (s: string): BarcodeFormat | undefined =>
  (Object.entries(ZXING_FORMAT).find(([, v]) => v === s)?.[0] as BarcodeFormat) ?? undefined;

// --- native BarcodeDetector --------------------------------------------------------------
// Chrome/Edge/Samsung Internet on Android only, per caniuse (checked 2026-10): Safari has it
// disabled by default, Firefox doesn't have it at all. Always feature-detected, never assumed.
type NativeCtor = new (opts: { formats: string[] }) => { detect: (s: CanvasImageSource | ImageData) => Promise<{ rawValue: string; format: string; cornerPoints?: { x: number; y: number }[] }[]> };

class NativeEngine implements DetectionEngine {
  readonly name = "native" as const;
  private supported: boolean | null = null;

  async available(): Promise<boolean> {
    if (this.supported != null) return this.supported;
    const Ctor = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
    if (!Ctor) return (this.supported = false);
    try {
      // getSupportedFormats is itself async on some implementations; a bare construction is
      // enough to prove the class exists and doesn't throw synchronously.
      new Ctor({ formats: ["qr_code"] });
      this.supported = true;
    } catch {
      this.supported = false;
    }
    return this.supported;
  }

  async detect(source: CanvasImageSource | ImageData, formats: BarcodeFormat[]): Promise<RawDetection[]> {
    const Ctor = (window as unknown as { BarcodeDetector?: NativeCtor }).BarcodeDetector;
    if (!Ctor) return [];
    const detector = new Ctor({ formats: formats.map((f) => NATIVE_FORMAT[f]) });
    const hits = await detector.detect(source as CanvasImageSource);
    return hits
      .map((h): RawDetection | null => {
        const format = fromNativeFormat(h.format);
        if (!format) return null;
        const pts = h.cornerPoints;
        const point = pts?.length ? { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length } : undefined;
        return { text: h.rawValue, format, engine: "native", point };
      })
      .filter((x): x is RawDetection => x != null);
  }
}

// --- zxing-wasm ----------------------------------------------------------------------------
// Already a project dependency (used previously by invoiceReader.ts / qrScanner.ts). Loaded
// lazily so it never costs anything on a page that doesn't open a scanner.
let zxingReady: Promise<typeof import("zxing-wasm/reader").readBarcodes> | null = null;
async function loadZxing() {
  if (!zxingReady) {
    zxingReady = (async () => {
      const { readBarcodes, setZXingModuleOverrides } = await import("zxing-wasm/reader");
      const wasmUrl = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
      setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) });
      return readBarcodes;
    })();
  }
  return zxingReady;
}

class ZxingEngine implements DetectionEngine {
  readonly name = "zxing" as const;

  async available(): Promise<boolean> {
    return true; // works in every browser this project supports (WASM, no native API needed)
  }

  async detect(source: CanvasImageSource | ImageData, formats: BarcodeFormat[]): Promise<RawDetection[]> {
    const readBarcodes = await loadZxing();
    let imageData: ImageData;
    if (source instanceof ImageData) {
      imageData = source;
    } else {
      // zxing-wasm's readBarcodes needs ImageData — draw whatever source we were given
      // (video frame, ImageBitmap) onto an offscreen canvas once.
      const w = "videoWidth" in source ? (source as HTMLVideoElement).videoWidth : (source as ImageBitmap).width;
      const h = "videoHeight" in source ? (source as HTMLVideoElement).videoHeight : (source as ImageBitmap).height;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(source, 0, 0, w, h);
      imageData = ctx.getImageData(0, 0, w, h);
    }
    const hits = await readBarcodes(imageData, {
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      formats: formats.map((f) => ZXING_FORMAT[f]) as never,
      maxNumberOfSymbols: 4,
    });
    return hits
      .map((h): RawDetection | null => {
        const format = fromZxingFormat(h.format);
        if (!format || !h.text) return null;
        const pos = h.position;
        const point = pos ? { x: (pos.topLeft.x + pos.bottomRight.x) / 2, y: (pos.topLeft.y + pos.bottomRight.y) / 2 } : undefined;
        return { text: h.text, format, engine: "zxing", point };
      })
      .filter((x): x is RawDetection => x != null);
  }
}

export const nativeEngine: DetectionEngine = new NativeEngine();
export const zxingEngine: DetectionEngine = new ZxingEngine();

/** Runs native first (fast path) and only falls back to zxing if native found nothing —
 *  the staged strategy the brief asked for, so the (slower) WASM decode doesn't run on every
 *  single frame when the fast path is already succeeding. */
export async function detectStaged(source: CanvasImageSource | ImageData, formats: BarcodeFormat[]): Promise<RawDetection[]> {
  if (await nativeEngine.available()) {
    const hits = await nativeEngine.detect(source, formats);
    if (hits.length) return hits;
  }
  return zxingEngine.detect(source, formats);
}

/** Runs BOTH engines and returns their results separately — used by the verifier's
 *  engine-agreement check, which needs to know what each engine saw independently. */
export async function detectBoth(source: CanvasImageSource | ImageData, formats: BarcodeFormat[]): Promise<{ native: RawDetection[]; zxing: RawDetection[] }> {
  const [native, zxing] = await Promise.all([
    nativeEngine.available().then((ok) => (ok ? nativeEngine.detect(source, formats) : [])),
    zxingEngine.detect(source, formats),
  ]);
  return { native, zxing };
}
