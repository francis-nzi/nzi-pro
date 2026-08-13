"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type LeverOption = {
  lever_id: number;
  sphere_code: string | null;
  sphere_name: string | null;
  sub_sphere_code: string | null;
  sub_sphere_name: string | null;
  lever_code: string;
  lever_name: string;
  lever_description: string | null;
  is_custom: boolean;
};

type LeverGroup = {
  key: string;
  label: string;
  options: LeverOption[];
};

type LeverSelectProps = {
  id?: string;
  value: number | null;
  options: LeverOption[];
  onValueChange: (leverId: number) => void;
  placeholder?: string;
  ariaInvalid?: boolean;
  disabled?: boolean;
  className?: string;
};

function displayLabel(option: LeverOption | undefined): string {
  if (!option) return "";
  const detail = option.lever_description || option.lever_name;
  return `${option.lever_code} — ${detail}`;
}

const PANEL_MAX_HEIGHT = 288; // max-h-72

export default function LeverSelect({
  id,
  value,
  options,
  onValueChange,
  placeholder = "Select a lever...",
  ariaInvalid,
  disabled = false,
  className,
}: LeverSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Viewport-relative coordinates for the portaled panel, recomputed on open
  // and on scroll/resize -- see the comment below on why this can't just be
  // position:absolute inside the field.
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number; openUpward: boolean } | null>(null);

  const selectedOption = useMemo(() => options.find((o) => o.lever_id === value), [options, value]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function reposition() {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < PANEL_MAX_HEIGHT + 8 && rect.top > spaceBelow;
      setPanelPos({
        top: openUpward ? rect.top - 4 : rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 320),
        openUpward,
      });
    }

    reposition();
    // This field commonly sits inside a scrollable dialog (overflow-y-auto),
    // which clips any absolutely-positioned panel that would extend past the
    // dialog's own visible area -- and dragging that scrollbar to reach it
    // is a mousedown outside the field, which used to close the dropdown
    // entirely before the user could scroll to it. Portaling to <body> with
    // viewport-fixed coordinates escapes that clipping; capture-phase scroll
    // (catches the dialog's internal scroll, not just window/page scroll)
    // keeps the panel following the field instead of just closing.
    window.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const groups = useMemo<LeverGroup[]>(() => {
    const trimmed = query.trim().toLowerCase();
    const matches = (option: LeverOption) =>
      !trimmed ||
      `${option.lever_code} ${option.lever_name} ${option.lever_description || ""} ${option.sphere_name || ""} ${option.sub_sphere_name || ""}`
        .toLowerCase()
        .includes(trimmed);

    const standardByKey = new Map<string, LeverGroup>();
    const custom: LeverOption[] = [];
    for (const option of options) {
      if (!matches(option)) continue;
      if (option.is_custom) {
        custom.push(option);
        continue;
      }
      const key = `${option.sphere_code || ""}-${option.sub_sphere_code || ""}`;
      if (!standardByKey.has(key)) {
        standardByKey.set(key, {
          key,
          label: `Sphere ${option.sphere_code} — ${option.sub_sphere_code} ${option.sub_sphere_name || ""}`,
          options: [],
        });
      }
      standardByKey.get(key)!.options.push(option);
    }
    const result = Array.from(standardByKey.values());
    if (custom.length > 0) {
      result.push({ key: "custom", label: "Custom Levers", options: custom });
    }
    return result;
  }, [options, query]);

  function handleSelect(option: LeverOption) {
    onValueChange(option.lever_id);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={open ? query : displayLabel(selectedOption)}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className={cn("pr-9", className)}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50" />
      </div>

      {open && !disabled && panelPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-50 rounded-md border bg-popover shadow-lg"
              style={{
                left: panelPos.left,
                width: panelPos.width,
                ...(panelPos.openUpward
                  ? { bottom: window.innerHeight - panelPos.top, maxHeight: PANEL_MAX_HEIGHT }
                  : { top: panelPos.top, maxHeight: PANEL_MAX_HEIGHT }),
              }}
            >
              <div className="max-h-72 overflow-y-auto p-1">
                {groups.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">No matching levers</div>
                ) : (
                  groups.map((group) => (
                    <div key={group.key} className="mb-1">
                      <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </div>
                      {group.options.map((option) => {
                        const selected = option.lever_id === value;
                        return (
                          <button
                            key={option.lever_id}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSelect(option);
                            }}
                            className={cn(
                              "flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                              selected && "bg-accent/70 font-medium"
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="font-medium">{option.lever_code}</span>{" "}
                              <span className="text-muted-foreground">{option.lever_description || option.lever_name}</span>
                            </span>
                            {selected && <Check className="mt-0.5 size-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
