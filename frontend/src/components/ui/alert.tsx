import * as React from "react";
import { cn } from "@/lib/utils";

type AlertProps = React.HTMLAttributes<HTMLDivElement>;

export function Alert({ className, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", className)}
      {...props}
    />
  );
}

type AlertDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  return <p className={cn("leading-6", className)} {...props} />;
}
