"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchableStringSelectProps = {
  id?: string;
  value: string;
  options: string[];
  placeholder?: string;
  ariaInvalid?: boolean;
  className?: string;
  disabled?: boolean;
  noMatchesText?: string;
  showClearButton?: boolean;
  optionBadges?: Record<string, string | number>;
  /** When false, only values from `options` can be selected -- typing
   * something that isn't in the list and pressing Enter is a no-op instead
   * of committing the typed text. Defaults to true (existing behavior). */
  allowCustomValue?: boolean;
  onValueChange: (value: string) => void;
};

export default function SearchableStringSelect({
  id,
  value,
  options,
  placeholder = "Search...",
  ariaInvalid,
  className,
  disabled = false,
  noMatchesText = "No matches found",
  showClearButton = false,
  optionBadges,
  allowCustomValue = true,
  onValueChange,
}: SearchableStringSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery(value);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value]);

  const filteredOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const base = trimmed
      ? options.filter((option) => option.toLowerCase().includes(trimmed))
      : options;
    return base.slice(0, 100);
  }, [options, query]);

  function handleSelect(option: string) {
    onValueChange(option);
    setQuery(option);
    setOpen(false);
  }

  function handleClear() {
    onValueChange("");
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      if (filteredOptions.length > 0) {
        handleSelect(filteredOptions[0]);
      } else if (query.trim() && allowCustomValue) {
        onValueChange(query.trim());
        setOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={open ? query : value}
          onChange={(event) => {
            setOpen(true);
            setQuery(event.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            window.setTimeout(() => {
              if (!wrapperRef.current?.contains(document.activeElement)) {
                setOpen(false);
                setQuery(value);
              }
            }, 120);
          }}
          placeholder={placeholder}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className={cn(showClearButton ? "pr-16" : "pr-9", className)}
        />
        {showClearButton && value && !disabled ? (
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              handleClear();
            }}
            className="absolute right-8 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            Clear
          </button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-50" />
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg">
          <div className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const selected = option === value;
                const badgeValue = optionBadges?.[option];
                return (
                  <button
                    key={option}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(option);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                      selected && "bg-accent/70 font-medium"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                    {badgeValue !== undefined ? (
                      <span className="ml-2 inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {badgeValue}
                      </span>
                    ) : null}
                    {selected && <Check className="ml-2 size-4 shrink-0" />}
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {noMatchesText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
