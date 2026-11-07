"use client";

import { useState } from "react";
import { cx, seconds } from "@/lib/format";
import type { Step } from "@/lib/types";
import { Spinner } from "../ui";

/** Agent execution steps (spec F09): dashed card, 2-column list, collapsible. */
export function StepsCard({
  steps,
  run,
  running,
}: {
  steps: Step[];
  run?: { steps: number; ms: number };
  running: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (!steps.length && !running) return null;
  const header = run
    ? `${run.steps}단계 실행 · ${seconds(run.ms)}`
    : running
      ? `실행 중 · ${steps.length}단계`
      : `${steps.length}단계 실행`;
  return (
    <div className="w-[85%] self-start rounded-[12px] border border-dashed border-line-strong bg-surface px-3.5 py-2.5 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left font-semibold text-muted"
      >
        <span className="flex items-center gap-1.5">
          {running && !run && <Spinner size={12} />}
          {header}
        </span>
        <span aria-hidden>{open ? "접기 ▴" : "펼치기 ▾"}</span>
      </button>
      {open && steps.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {steps.map((s, i) => (
            <li key={`${s.tool}-${i}`} className="grid grid-cols-[14px_auto_minmax(0,1fr)] items-baseline gap-1.5">
              <span
                className={cx(
                  "font-bold",
                  s.status === "done" && "text-good",
                  s.status === "failed" && "text-danger",
                  s.status === "running" && "text-muted",
                )}
                aria-label={s.status === "done" ? "완료" : s.status === "failed" ? "실패" : "실행 중"}
              >
                {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "…"}
              </span>
              <span className="font-mono text-[10.5px] text-accent">{s.tool}</span>
              <span className="truncate text-ink" title={s.summary}>
                {s.summary}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
