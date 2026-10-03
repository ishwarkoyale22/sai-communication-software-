// Shared types for the scanner engine used by both IMEI/serial scanning and
// invoice/product QR scanning (Inventory.tsx + InvoiceImportModal.tsx).
// See apps/admin/src/lib/scanner/README.md for the overall architecture.

/** The barcode symbologies this app ever needs to read. Keep this list in sync with
 *  engines.ts' format-name mapping for both the native BarcodeDetector and zxing-wasm. */
export type BarcodeFormat = "qr_code" | "code_128" | "code_39" | "ean_13" | "ean_8" | "upc_a" | "upc_e" | "itf";

export const IMEI_FORMATS: BarcodeFormat[] = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf"];
export const QR_FORMATS: BarcodeFormat[] = ["qr_code"];

/** One raw decode from one engine, for one frame/image. Never shown to the user directly —
 *  always passes through the verifier (live) or staged-decode candidate logic (photo) first. */
export interface RawDetection {
  text: string;
  format: BarcodeFormat;
  engine: "native" | "zxing";
  /** Approximate bounding-box center in the SOURCE frame's own pixel coordinates, when the
   *  engine provides one (native does; zxing's position is normalized separately in engines.ts). */
  point?: { x: number; y: number };
}

/** A single detection engine. Both engines implement this so the rest of the pipeline
 *  (verifier, camera loop, photo pipeline) never needs to know which one ran. */
export interface DetectionEngine {
  readonly name: "native" | "zxing";
  /** Cheap/cached — may involve one-time feature detection, never a network call after warmup. */
  available(): Promise<boolean>;
  /** Runs one decode pass over the given source, restricted to the given formats. */
  detect(source: CanvasImageSource | ImageData, formats: BarcodeFormat[]): Promise<RawDetection[]>;
}
