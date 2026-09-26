import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";

interface BrandOpt {
  id: string;
  name: string;
  is_active: boolean;
}

/** Type a brand or pick an existing one. Existing brands are listed as soon as the box is focused and filter while typing. */
export function BrandCombobox({
  value,
  brands,
  onChange,
}: {
  value: string;
  brands: BrandOpt[];
  onChange: (text: string, match: BrandOpt | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // One entry per brand name (the list can hold duplicates), active brands only.
  const unique = useMemo(() => {
    const seen = new Set<string>();
    return brands.filter((b) => {
      const k = b.name.trim().toLowerCase();
      if (!b.is_active || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [brands]);

  const q = value.trim().toLowerCase();
  const shown = unique.filter((b) => !q || b.name.toLowerCase().includes(q));
  const exact = brands.find((b) => b.name.trim().toLowerCase() === q);

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="input w-full pr-8"
        placeholder="Type or pick a brand"
        autoComplete="off"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          const text = e.target.value;
          onChange(text, brands.find((b) => b.name.trim().toLowerCase() === text.trim().toLowerCase()));
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Show brands"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-white shadow-lg">
          {shown.map((b) => (
            <button
              key={b.id}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(b.name, b);
                setOpen(false);
              }}
            >
              {b.name}
            </button>
          ))}
          {shown.length === 0 && !q && <div className="px-3 py-2 text-xs text-gray-400">No brands yet — type a name to add one.</div>}
          {q && !exact && (
            <button
              type="button"
              className="flex w-full items-center gap-1 border-t border-border px-3 py-1.5 text-left text-sm font-medium text-brand-primary hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(false)}
            >
              <Plus size={13} /> Add "{value.trim()}" as a new brand
            </button>
          )}
        </div>
      )}
    </div>
  );
}
