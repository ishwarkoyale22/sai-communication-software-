"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Lightweight scroll-reveal: fades + lifts a block into view once it enters
 * the viewport. Implemented with IntersectionObserver directly (no animation
 * library) to keep the website's dependency footprint small.
 *
 * `delay` staggers siblings (ms). Respects prefers-reduced-motion via the
 * global CSS override in globals.css, which collapses all transitions.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Fail open: if IntersectionObserver isn't available (very old browser,
    // or an embedding context that never composites a frame), show the
    // content immediately rather than leaving it at opacity:0 forever.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        },
        { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
      );
      observer.observe(el);
    } catch {
      setVisible(true);
      return;
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
      style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}
