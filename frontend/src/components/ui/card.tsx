import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardProps = {
  className?: string;
  children: ReactNode;
};

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        "surface-card",
        className,
      )}
    >
      {children}
    </div>
  );
}
