// Live camera reader for dense QR codes (GST e-invoice QRs). html5-qrcode crops the frame to a small box
// and runs at low resolution, which is why such QRs never decode. This instead asks the camera for its
// highest resolution with continuous focus, then tries the phone's own barcode detector (the same
// Google engine Google Pay / PhonePe use on Android Chrome) and the zxing-wasm decoder on the FULL frame.
//
// Detection itself now runs through lib/scanner/engines.ts — the same native-then-zxing engines the
// IMEI scanner uses — instead of its own separate copy of that logic. Everything else here (the public
// API, first-decode-wins behavior, full-frame reads, zoom/torch) is unchanged from before this move, per
// the requirement to preserve existing invoice-scanning functionality exactly.
import { detectStaged } from "./scanner/engines";

export interface QrScanHandle {
  stop: () => Promise<void>;
  /** Present only when the camera supports zoom. */
  zoom?: { min: number; max: number; step: number; value: number };
  setZoom: (v: number) => Promise<void>;
  torchSupported: boolean;
  setTorch: (on: boolean) => Promise<void>;
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

  let stopped = false;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const loop = async () => {
    while (!stopped) {
      await new Promise((r) => setTimeout(r, 120));
      if (stopped || video.readyState < 2 || !video.videoWidth) continue;
      try {
        const k = Math.min(1, 2400 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * k);
        canvas.height = Math.round(video.videoHeight * k);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Same staged strategy as before: native detector first (fast path), zxing-wasm only if
        // native found nothing or isn't available (e.g. iPhone Safari) — see engines.ts.
        const hits = await detectStaged(imageData, ["qr_code"]);
        if (hits[0]?.text) return onDecoded(hits[0].text);
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
