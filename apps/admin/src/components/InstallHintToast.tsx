import { useEffect } from "react";
import { Share, MoreVertical, Monitor } from "lucide-react";
import { isIos, isAndroid } from "../lib/useInstallPrompt";

/**
 * The smallest possible fallback when there is no real install prompt to trigger — one line, no
 * numbered steps, no dialog to dismiss. Auto-hides itself; the person can also tap it away.
 * Only shown at all when there is genuinely no programmatic alternative (see useInstallPrompt).
 */
export function InstallHintToast({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [onDone]);

  const { Icon, text } = isIos()
    ? { Icon: Share, text: "Tap Share, then Add to Home Screen" }
    : isAndroid()
      ? { Icon: MoreVertical, text: "Open ⋮ menu → Install app" }
      : { Icon: Monitor, text: "Look for the install icon in the address bar, or open the browser menu" };

  return (
    <div
      onClick={onDone}
      className="fixed inset-x-0 bottom-4 z-[100] mx-auto flex w-fit max-w-[92vw] cursor-pointer items-center gap-2 rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg animate-in fade-in slide-in-from-bottom-2"
    >
      <Icon size={15} className="shrink-0 text-gold" />
      <span>{text}</span>
    </div>
  );
}
