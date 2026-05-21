"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TaskAssigneeOption = {
  value: string;
  label: string;
  meta?: string | null;
};

type Props = {
  value: string[];
  options: TaskAssigneeOption[];
  onChange: (next: string[]) => void;
  loading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  className?: string;
};

export default function TaskAssigneePicker({
  value,
  options,
  onChange,
  loading = false,
  placeholder = "Search people...",
  emptyMessage = "No matches",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOptions = useMemo(
    () => value.map((selected) => options.find((option) => option.value === selected)).filter(Boolean) as TaskAssigneeOption[],
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => {
      const haystack = `${option.label} ${option.meta || ""} ${option.value}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  useEffect(() => {
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  function toggleValue(optionValue: string) {
    onChange(
      value.includes(optionValue)
        ? value.filter((existing) => existing !== optionValue)
        : [...value, optionValue]
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      {selectedOptions.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedOptions.map((option) => (
            <Badge key={option.value} variant="secondary" className="gap-1 pr-1.5">
              <span className="max-w-[18rem] truncate">{option.label}</span>
              <button
                type="button"
                onClick={() => toggleValue(option.value)}
                className="rounded-full p-0.5 hover:bg-muted/60"
                aria-label={`Remove ${option.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => onChange([])}
          >
            Clear all
          </Button>
        </div>
      ) : null}

      <Input
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {open ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {loading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
          ) : filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            filteredOptions.map((option) => {
              const checked = value.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-accent ${
                    checked ? "bg-accent/50" : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    toggleValue(option.value);
                    setOpen(true);
                  }}
                >
                  <span
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded border ${
                      checked ? "border-primary bg-primary" : "border-slate-300 bg-white"
                    }`}
                  >
                    {checked ? <span className="block text-center text-[10px] leading-4 text-white">x</span> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{option.label}</span>
                    {option.meta ? <span className="block text-xs text-muted-foreground">{option.meta}</span> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
