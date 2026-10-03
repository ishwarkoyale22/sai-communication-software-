// Multi-frame verification. This is the component responsible for the project's core safety
// rule: a value is only ever accepted after repeated agreement, and a conflicting read NEVER
// causes a silent choice between candidates — see README.md "Multi-frame / confidence strategy".
import type { RawDetection } from "./types";

export interface VerifierConfig {
  /** How many matching reads are required before a candidate is accepted.
   *  Configurable, not hard-coded — start at 3, tune after real-device testing (per the brief). */
  requiredMatches: number;
  /** A read older than this (ms) no longer counts toward the current candidate's match count —
   *  prevents a stale read from a user who moved the camera away and back from still counting. */
  windowMs: number;
  /** A different valid-format candidate seen within this window than the one being built up
   *  invalidates it (does not silently keep the first one, does not silently switch to the new
   *  one) — both are discarded and verification restarts from zero. */
}

export const DEFAULT_VERIFIER_CONFIG: VerifierConfig = { requiredMatches: 3, windowMs: 4000 };

export type VerifierOutcome =
  | { status: "pending"; text: string; matches: number; required: number }
  | { status: "accepted"; text: string; format: RawDetection["format"]; matches: number }
  | { status: "conflict"; a: string; b: string }
  | { status: "idle" };

interface ReadEntry {
  text: string;
  format: RawDetection["format"];
  at: number;
}

/** One instance per active scan session. Call push() for every detection (from either engine,
 *  live frame or — with a lower bar, see imageSource.ts — a photo's processing passes) and act
 *  only on an "accepted" or "conflict" outcome; "pending" means keep scanning, say nothing
 *  alarming to the user beyond a quiet progress indicator. */
export class MultiFrameVerifier {
  private reads: ReadEntry[] = [];
  private config: VerifierConfig;

  constructor(config: Partial<VerifierConfig> = {}) {
    this.config = { ...DEFAULT_VERIFIER_CONFIG, ...config };
  }

  reset() {
    this.reads = [];
  }

  /** Feed one or more detections from a single frame/pass. When two engines ran on the SAME
   *  frame and disagree (different text), that frame contributes nothing toward either
   *  candidate and is itself a conflict signal — engine disagreement on one frame is treated
   *  the same as disagreement across frames: no guess, no silent pick. */
  push(detections: RawDetection[]): VerifierOutcome {
    const now = Date.now();
    this.reads = this.reads.filter((r) => now - r.at < this.config.windowMs);

    if (detections.length === 0) return this.currentOutcome();

    const distinctTexts = new Set(detections.map((d) => d.text));
    if (distinctTexts.size > 1) {
      // Two engines (or two candidates in one frame) disagreed on this exact frame.
      const [a, b] = [...distinctTexts];
      this.reads = []; // discard everything accumulated so far — do not let a stale match count survive a conflict
      return { status: "conflict", a, b };
    }

    for (const d of detections) this.reads.push({ text: d.text, format: d.format, at: now });
    return this.currentOutcome();
  }

  private currentOutcome(): VerifierOutcome {
    if (this.reads.length === 0) return { status: "idle" };

    // Group remaining (window-filtered) reads by text. If more than one distinct text is
    // currently "live" within the window, that's a conflict too (e.g. frame 1 saw A, frame 2
    // saw B, both still inside the window) — never silently prefer whichever has more reads.
    const byText = new Map<string, ReadEntry[]>();
    for (const r of this.reads) byText.set(r.text, [...(byText.get(r.text) ?? []), r]);

    if (byText.size > 1) {
      const sorted = [...byText.entries()].sort((a, b) => b[1].length - a[1].length);
      return { status: "conflict", a: sorted[0][0], b: sorted[1][0] };
    }

    const [text, entries] = [...byText.entries()][0];
    if (entries.length >= this.config.requiredMatches) {
      return { status: "accepted", text, format: entries[entries.length - 1].format, matches: entries.length };
    }
    return { status: "pending", text, matches: entries.length, required: this.config.requiredMatches };
  }
}
