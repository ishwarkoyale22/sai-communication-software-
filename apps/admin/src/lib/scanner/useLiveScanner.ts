// The one React hook both the IMEI scanner and the invoice/QR scanner are built on. Camera
// lifecycle (cameraSource.ts) + detection loop (engines.ts) + acceptance rule (verifier.ts) are
// generic; IMEI-specific validation and invoice-specific parsing stay in their own callers.
import { useCallback, useEffect, useRef, useState } from "react";
import { startCamera, type CameraHandle } from "./cameraSource";
import { detectBoth } from "./engines";
import { MultiFrameVerifier, type VerifierConfig, type VerifierOutcome } from "./verifier";
import type { BarcodeFormat } from "./types";

export interface LiveScannerState {
  active: boolean;
  feedback: string | null;
  torchSupported: boolean;
  torchOn: boolean;
  zoom?: { min: number; max: number; step: number; value: number };
  /** Set only while status is "pending" — lets the UI show "Reading 8696… (2/3)". */
  pendingText: string | null;
  pendingProgress: { matches: number; required: number } | null;
}

export interface UseLiveScannerOptions {
  formats: BarcodeFormat[];
  verifier?: Partial<VerifierConfig>;
  /** Called once per accepted value. The hook does NOT stop itself afterward — callers that
   *  want "stop on first accept" (the invoice QR flow) call stop() themselves from this
   *  callback; callers that want continuous scanning (IMEI batch entry) just keep going. */
  onAccepted: (text: string, format: BarcodeFormat) => void;
  /** Called on every conflicting-read event. Never silently resolved — the UI should tell the
   *  user to hold steady / retry, never guess which candidate was "probably" right. */
  onConflict?: (a: string, b: string) => void;
  /** If no value accepted within this many ms, camera steps up to a higher resolution once.
   *  Default 3000ms. Set null to disable (e.g. for short-lived scans). */
  resolutionBumpAfterMs?: number | null;
}

const DETECT_INTERVAL_MS = 180;

export function useLiveScanner(options: UseLiveScannerOptions) {
  // "Latest ref" pattern: mirrors the newest callbacks/config into a ref so the async detection
  // loop (which lives outside React's render cycle) always calls the current closure without
  // needing to be restarted. This assignment is a plain synchronous write with no side effects
  // and never schedules a render — it is not the "setState in render" pattern the lint rule
  // targets, it only looks similar because it also touches a ref.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<LiveScannerState>({
    active: false,
    feedback: null,
    torchSupported: false,
    torchOn: false,
    zoom: undefined,
    pendingText: null,
    pendingProgress: null,
  });

  const cameraRef = useRef<CameraHandle | null>(null);
  const verifierRef = useRef<MultiFrameVerifier | null>(null);
  const loopStoppedRef = useRef(true);
  const resolutionBumpedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const applyOutcome = useCallback((outcome: VerifierOutcome) => {
    if (outcome.status === "accepted") {
      setState((s) => ({ ...s, pendingText: null, pendingProgress: null, feedback: null }));
      optionsRef.current.onAccepted(outcome.text, outcome.format);
    } else if (outcome.status === "conflict") {
      setState((s) => ({ ...s, pendingText: null, pendingProgress: null, feedback: "Different values detected — hold the barcode steady and try again." }));
      optionsRef.current.onConflict?.(outcome.a, outcome.b);
    } else if (outcome.status === "pending") {
      setState((s) => ({ ...s, pendingText: outcome.text, pendingProgress: { matches: outcome.matches, required: outcome.required }, feedback: null }));
    }
  }, []);

  const stop = useCallback(() => {
    loopStoppedRef.current = true;
    cameraRef.current?.stop();
    cameraRef.current = null;
    verifierRef.current = null;
    resolutionBumpedRef.current = false;
    setState({ active: false, feedback: null, torchSupported: false, torchOn: false, zoom: undefined, pendingText: null, pendingProgress: null });
  }, []);

  const start = useCallback(
    async (container: HTMLElement) => {
      setState((s) => ({ ...s, active: true, feedback: null }));
      try {
        const camera = await startCamera(container);
        cameraRef.current = camera;
        verifierRef.current = new MultiFrameVerifier(optionsRef.current.verifier);
        loopStoppedRef.current = false;
        resolutionBumpedRef.current = false;
        canvasRef.current = canvasRef.current ?? document.createElement("canvas");

        setState((s) => ({
          ...s,
          active: true,
          torchSupported: camera.torchSupported,
          zoom: camera.zoom ? { ...camera.zoom, value: camera.zoom.min } : undefined,
        }));

        const bumpAfter = optionsRef.current.resolutionBumpAfterMs ?? 3000;
        const startedAt = Date.now();

        const loop = async () => {
          while (!loopStoppedRef.current) {
            await new Promise((r) => setTimeout(r, DETECT_INTERVAL_MS));
            if (loopStoppedRef.current) return;
            const video = cameraRef.current?.video;
            if (!video || video.readyState < 2 || !video.videoWidth) continue;

            if (bumpAfter != null && !resolutionBumpedRef.current && Date.now() - startedAt > bumpAfter) {
              resolutionBumpedRef.current = true;
              void cameraRef.current?.increaseResolution();
            }

            try {
              const canvas = canvasRef.current!;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

              const { native, zxing } = await detectBoth(imageData, optionsRef.current.formats);
              // Feed native and zxing results as ONE combined frame observation: if both ran and
              // disagree, the verifier treats that as a same-frame conflict (see verifier.ts).
              // If only one engine found something (the common case — native-only or zxing-only
              // environments), that engine's result alone is what gets fed.
              const combined = native.length && zxing.length ? [...native, ...zxing] : native.length ? native : zxing;
              if (!verifierRef.current) continue;
              const outcome = verifierRef.current.push(combined);
              applyOutcome(outcome);
            } catch {
              /* a bad frame — keep scanning */
            }
          }
        };
        void loop();
      } catch (err) {
        setState((s) => ({ ...s, active: false, feedback: cameraErrorMessage(err) }));
      }
    },
    [applyOutcome]
  );

  const setZoom = useCallback(async (v: number) => {
    await cameraRef.current?.setZoom(v);
    setState((s) => (s.zoom ? { ...s, zoom: { ...s.zoom, value: v } } : s));
  }, []);

  const toggleTorch = useCallback(async () => {
    const next = !state.torchOn;
    await cameraRef.current?.setTorch(next);
    setState((s) => ({ ...s, torchOn: next }));
  }, [state.torchOn]);

  const resetVerification = useCallback(() => {
    verifierRef.current?.reset();
    setState((s) => ({ ...s, pendingText: null, pendingProgress: null }));
  }, []);

  useEffect(() => stop, [stop]); // guaranteed stop on unmount

  return { state, start, stop, setZoom, toggleTorch, resetVerification };
}

// Same mapping Inventory.tsx already used for html5-qrcode's thrown values — reused here since
// getUserMedia throws the identical DOMException names.
export function cameraErrorMessage(err: unknown): string {
  const text = typeof err === "string" ? err : "";
  const msg = err instanceof Error ? err.message || err.name : "";
  if (/NotAllowed|Permission/i.test(text + msg)) return "Camera permission is blocked. Tap the lock icon next to the address bar, set Camera to Allow, then reload and try again.";
  if (/NotFound|Requested device not found/i.test(text + msg)) return "No camera was found on this device.";
  if (/NotReadable|in use/i.test(text + msg)) return "The camera is being used by another app. Close it and try again.";
  if (!window.isSecureContext) return "The camera only works on a secure (https) page.";
  return msg || text || "Could not start the camera.";
}
