import { useEffect, type RefObject } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/**
 * Buttery, weighted scroll on every device — mouse wheel on desktop and
 * touch drags on phones/tablets both ride the same eased inertia, instead
 * of the browser's plain instant scroll. Same approach used on the
 * customer website (src/components/SmoothScroll.tsx there).
 *
 * Takes explicit wrapper/content refs instead of defaulting to
 * window/document: the app's actual scroll container is the `<main>` panel
 * in Layout.tsx (`overflow-y-auto`), not the page body — the sidebar and
 * header sit outside it and must stay fixed in place. Pointing Lenis at
 * `window` here would smooth nothing, since the page itself never scrolls.
 *
 * Deliberately lighter/faster than the marketing-site version (shorter
 * duration) — this is a data-entry tool people scan long tables in, not a
 * page people read top to bottom, so scrolling shouldn't feel "heavy".
 *
 * Respects prefers-reduced-motion automatically (a Lenis default) — index.css
 * already forces scroll-behavior:auto under that media query for anchor
 * jumps, and Lenis independently skips its own smoothing the same way, so a
 * user with reduced-motion enabled always gets instant scroll either way.
 *
 * allowNestedScroll: true is required — this app has its own nested
 * scrollable regions inside the Lenis-controlled `<main>` (the Add/Edit
 * Product modal's field list, the sidebar nav, tables with
 * overflow-x-auto). Without it, Lenis hijacks every wheel/touch gesture
 * for the outer `<main>` scroll, so those inner regions become
 * completely unscrollable — confirmed live: the Add Product modal on
 * mobile stopped scrolling entirely after this component was first added
 * without this option.
 */
export function SmoothScroll({
  wrapperRef,
  contentRef,
}: {
  wrapperRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!wrapperRef.current || !contentRef.current) return;

    const lenis = new Lenis({
      wrapper: wrapperRef.current,
      content: contentRef.current,
      duration: 0.7,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: true,
      syncTouchLerp: 0.075,
      touchMultiplier: 1,
      autoRaf: true,
      allowNestedScroll: true,
    });

    return () => lenis.destroy();
    // Re-run if the route swaps out the wrapper/content nodes (shouldn't
    // normally happen since Layout persists across routes, but this keeps
    // the scroller correctly attached if it ever does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapperRef.current, contentRef.current]);

  return null;
}
