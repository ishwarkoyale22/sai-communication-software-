// Camera lifecycle: adaptive resolution, continuous focus where supported, torch/zoom
// feature-detected (never assumed — iPhone Safari has none of these per the browser-support
// research in README.md), pause-on-hidden-tab, and a clean, guaranteed stop.
export interface CameraHandle {
  video: HTMLVideoElement;
  stop: () => void;
  zoom?: { min: number; max: number; step: number };
  setZoom: (v: number) => Promise<void>;
  torchSupported: boolean;
  setTorch: (on: boolean) => Promise<void>;
  /** Steps live resolution up once (720p -> 1080p) — called by the scanner hook after a
   *  configurable no-result timeout, not requested upfront. Keeps the common case
   *  (barcode decodes quickly) cheap on CPU/battery, per "do not force 4K everywhere". */
  increaseResolution: () => Promise<void>;
}

const LOW_RES = { width: { ideal: 1280 }, height: { ideal: 720 } };
const HIGH_RES = { width: { ideal: 1920 }, height: { ideal: 1080 } };

export async function startCamera(container: HTMLElement): Promise<CameraHandle> {
  let stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      ...LOW_RES,
      // focusMode is Chrome-for-Android only (not desktop Chrome, not iOS Safari) — harmless
      // to request elsewhere since unsupported `advanced` constraints are simply ignored rather
      // than rejected.
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

  let stopped = false;
  const onVisibility = () => {
    if (document.hidden) video.pause();
    else if (!stopped) void video.play().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisibility);

  const capsOf = () => (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number }; torch?: boolean };
  const apply = (c: Record<string, unknown>) => stream.getVideoTracks()[0]?.applyConstraints({ advanced: [c as MediaTrackConstraintSet] });

  const caps = capsOf();

  return {
    video,
    stop: () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      stream.getTracks().forEach((t) => t.stop());
      container.replaceChildren();
    },
    zoom: caps.zoom ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 } : undefined,
    setZoom: async (v) => {
      await apply({ zoom: v });
    },
    torchSupported: !!caps.torch,
    setTorch: async (on) => {
      await apply({ torch: on });
    },
    increaseResolution: async () => {
      try {
        await stream.getVideoTracks()[0]?.applyConstraints(HIGH_RES);
      } catch {
        // Some browsers refuse a resolution bump via applyConstraints after the stream is
        // live — fall back to a full re-acquire at the higher resolution.
        try {
          const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, ...HIGH_RES }, audio: false });
          stream.getTracks().forEach((t) => t.stop());
          stream = next;
          video.srcObject = stream;
          await video.play();
        } catch {
          /* keep running at the current resolution — never fail the whole scan over this */
        }
      }
    },
  };
}
