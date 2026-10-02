// Live camera reader for dense QR codes (GST e-invoice QRs). html5-qrcode crops the frame to a small box
// and runs at low resolution, which is why such QRs never decode. This instead asks the camera for its
// highest resolution with continuous focus, then tries the phone's own barcode detector (the same
// Google engine Google Pay / PhonePe use on Android Chrome) and the zxing-wasm decoder on the FULL frame.

export interface QrScanHandle {
  stop: () => Promise<void>;
  /** Present only when the camera supports zoom. */
  zoom?: { min: number; max: number; step: number; value: number };
  setZoom: (v: number) => Promise<void>;
  torchSupported: boolean;
  setTorch: (on: boolean) => Promise<void>;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

async function loadZxing() {
  const { readBarcodes, setZXingModuleOverrides } = await import("zxing-wasm/reader");
  const wasmUrl = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
  setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) });
  return readBarcodes;
}

export async function startQrScan(container: HTMLElement, onDecoded: (text: string) => void): Promise<QrScanHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
    },
    audio: false,
  });

  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.style.cssText = "width:100%;display:block;max-height:60vh;object-fit:cover";
  video.srcObject = stream;
  container.replaceChildren(video);
  await video.play();

  const track = stream.getVideoTracks()[0];
  const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number }; torch?: boolean };
  const apply = (c: Record<string, unknown>) => track.applyConstraints({ advanced: [c as MediaTrackConstraintSet] });

  const NativeDetector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  let native: Detector | null = null;
  try {
    native = NativeDetector ? new NativeDetector({ formats: ["qr_code"] }) : null;
  } catch {
    native = null;
  }
  const readBarcodes = await loadZxing();

  let stopped = false;
  let tick = 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const loop = async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 120));
      if (stopped || video.readyState < 2 || !video.videoWidth) continue;
      try {
        if (native) {
          const hit = (await native.detect(video))[0];
          if (hit?.rawValue) return onDecoded(hit.rawValue);
        }
        // Every other pass, also run the WASM decoder on the full frame (capped so it stays quick).
        if (tick++ % 2 === 0) {
          const k = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * k);
          canvas.height = Math.round(video.videoHeight * k);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const found = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), {
            tryHarder: true,
            tryRotate: true,
            tryInvert: true,
            tryDownscale: tick % 4 === 0, // downscaling helps with screen moiré, so alternate it
            formats: ["QRCode"],
            maxNumberOfSymbols: 1,
          });
          if (found[0]?.text) return onDecoded(found[0].text);
        }
      } catch {
        /* a bad frame — keep scanning */
      }
    }
  };
  void loop();

  const zoomCap = caps.zoom;
  return {
    stop: async () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      container.replaceChildren();
    },
    zoom: zoomCap ? { min: zoomCap.min, max: zoomCap.max, step: zoomCap.step || 0.1, value: zoomCap.min } : undefined,
    setZoom: async (v) => {
      await apply({ zoom: v });
    },
    torchSupported: !!caps.torch,
    setTorch: async (on) => {
      await apply({ torch: on });
    },
  };
}
