import { useState } from "react";

/**
 * The circular Sai Communication logo, used in every header and auth screen. On a flaky mobile
 * connection the plain `<img>` this replaces could fail to load and just sit there as an empty
 * circle until the next reload. This retries once (cache-busted, in case the first attempt hit a
 * transient network blip) and, only if that fails too, falls back to a plain "S" monogram so there
 * is never a blank or broken-image circle in the header.
 */
export function BrandLogo({ className = "" }: { className?: string }) {
  const [attempt, setAttempt] = useState(0); // 0 = first try, 1 = retried once, 2 = give up

  if (attempt >= 2) {
    return (
      <div className={`${className} flex items-center justify-center bg-gradient-to-br from-gold to-goldDim font-serif font-bold text-white`}>
        S
      </div>
    );
  }

  return (
    <img
      key={attempt}
      src={attempt === 0 ? "/logo-mark.png" : `/logo-mark.png?retry=${Date.now()}`}
      alt="Sai Communication"
      className={className}
      onError={() => setAttempt((a) => a + 1)}
    />
  );
}
