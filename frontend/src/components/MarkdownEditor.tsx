"use client";

import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Bold, Italic, List, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function MarkdownEditor({ value, onChange, placeholder, className }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertAround = (before: string, after: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, end + before.length);
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  return (
    <div className={`mt-3 flex flex-col ${className ?? ""}`}>
      <div className="flex items-center gap-1 rounded-t border border-b-0 bg-muted px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Bold"
          onClick={() => insertAround("**", "**")}
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Italic"
          onClick={() => insertAround("*", "*")}
        >
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <span className="mx-1 text-muted-foreground select-none">|</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Bullet list"
          onClick={() => insertLinePrefix("- ")}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          title="Numbered list"
          onClick={() => insertLinePrefix("1. ")}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
          Edit · Preview
        </span>
      </div>
      <div className="flex min-h-[280px] rounded-b border">
        <Textarea
          ref={textareaRef}
          className="flex-1 rounded-none rounded-bl border-0 border-r font-mono text-sm resize-none focus-visible:ring-0 focus-visible:ring-offset-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <div className="flex-1 overflow-auto p-3 report-markdown text-sm text-gray-700">
          {value ? (
            <ReactMarkdown>{value}</ReactMarkdown>
          ) : (
            <span className="text-muted-foreground italic">Preview will appear here…</span>
          )}
        </div>
      </div>
    </div>
  );
}
