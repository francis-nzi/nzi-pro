"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  allowCreateCustom?: boolean;
  onCreateCustomLever?: (name: string, description: string) => Promise<LeverOption | null>;
};

function displayLabel(option: LeverOption | undefined): string {
  if (!option) return "";
  const detail = option.lever_description || option.lever_name;
  return `${option.lever_code} — ${detail}`;
}

export default function LeverSelect({
  id,
  value,
  options,
  onValueChange,
  placeholder = "Select a lever...",
  ariaInvalid,
  disabled = false,
  className,
  allowCreateCustom = false,
  onCreateCustomLever,
}: LeverSelectProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedOption = useMemo(() => options.find((o) => o.lever_id === value), [options, value]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
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
    setCreating(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setCreating(false);
    }
  }

  async function handleCreateCustomLever() {
    if (!onCreateCustomLever) return;
    const name = newName.trim();
    if (!name) {
      setCreateError("Name is required");
      return;
    }
    setSaving(true);
    setCreateError("");
    try {
      const created = await onCreateCustomLever(name, newDescription.trim());
      if (created) {
        onValueChange(created.lever_id);
        setNewName("");
        setNewDescription("");
        setCreating(false);
        setOpen(false);
      } else {
        setCreateError("Failed to create custom lever");
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create custom lever");
    } finally {
      setSaving(false);
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

      {open && !disabled ? (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-md border bg-popover shadow-lg">
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

          {allowCreateCustom && onCreateCustomLever ? (
            <div className="border-t p-2">
              {!creating ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setCreating(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add custom lever
                </Button>
              ) : (
                <div className="space-y-2 p-1">
                  <Input
                    autoFocus
                    placeholder="Custom lever name"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                  <Textarea
                    placeholder="Description (optional)"
                    rows={2}
                    value={newDescription}
                    onChange={(event) => setNewDescription(event.target.value)}
                  />
                  {createError ? <div className="text-xs text-destructive">{createError}</div> : null}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={handleCreateCustomLever} disabled={saving}>
                      {saving ? "Creating..." : "Create"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
