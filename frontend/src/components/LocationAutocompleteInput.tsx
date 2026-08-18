"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

export type LocationCandidate = {
  label: string;
  latitude: number;
  longitude: number;
  precision: string;
};

type Props = {
  baseUrl: string;
  value: string;
  onChange: (text: string) => void;
  onSelect?: (candidate: LocationCandidate) => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
};

// Debounced live location lookup, backing free-text place fields (e.g. a
// transport leg's origin/destination) with real Nominatim-confirmed
// suggestions instead of letting someone type a name that only turns out
// to be unresolvable once they hit Save. Picking a suggestion replaces the
// field with Nominatim's own canonical label, so the existing save-time
// geocode call (services/geocoding.py geocode_location) is just echoing
// back a name it has already confirmed exists.
//
// Nominatim does prefix/token matching, not edit-distance fuzzy matching --
// a garbled single word (e.g. "perac") still won't surface "Perak" here.
// What this does fix: no more waiting until Save to discover a typo, and a
// mostly-right query (or one with at least one correctly-spelled token)
// will surface a pickable match while typing.
//
// GET /jobs/geocoding/search (api/lca_routes.py) is throttled server-side
// (services/geocoding.py _throttled_get) to Nominatim's >=1 request/second
// policy across the whole app, not just this input -- the 500ms debounce
// and 3-character minimum here keep actual request volume low, but the
// server-side throttle is what makes this safe under concurrent use.
export default function LocationAutocompleteInput({
  baseUrl,
  value,
  onChange,
  onSelect,
  onFocus,
  placeholder,
  className,
}: Props) {
  const [results, setResults] = useState<LocationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const text = value.trim();
    if (text.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const seq = ++requestSeq.current;
      (async () => {
        try {
          const res = await fetch(`${baseUrl}/jobs/geocoding/search?q=${encodeURIComponent(text)}&limit=5`, {
            credentials: "include",
          });
          if (seq !== requestSeq.current) return; // a newer query superseded this one
          if (res.ok) {
            const data = await res.json();
            setResults(Array.isArray(data.items) ? data.items : []);
          } else {
            setResults([]);
          }
        } catch {
          if (seq === requestSeq.current) setResults([]);
        } finally {
          if (seq === requestSeq.current) setLoading(false);
        }
      })();
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, baseUrl]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          onFocus?.();
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className={className}
      />
      {open && (loading || results.length > 0) ? (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
          ) : (
            results.map((c) => (
              <button
                key={`${c.label}-${c.latitude}-${c.longitude}`}
                type="button"
                onMouseDown={() => {
                  onChange(c.label);
                  onSelect?.(c);
                  setOpen(false);
                  setResults([]);
                }}
                className="block w-full truncate px-3 py-2 text-left text-xs hover:bg-muted"
                title={c.label}
              >
                {c.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
