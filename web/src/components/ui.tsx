"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/format";

type ButtonVariant = "primary" | "ghost" | "subtle" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  ghost: "border border-line-strong bg-surface text-ink hover:bg-tile",
  subtle: "text-muted hover:bg-tile hover:text-ink",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-soft",
};

export function Button({
  variant = "primary",
  className,
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(buttonBase, buttonVariants[variant], className)}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cx(buttonBase, buttonVariants[variant], className)}>
      {children}
    </Link>
  );
}

export function Card({
  className,
  children,
  as: Tag = "section",
  ...rest
}: { className?: string; children: React.ReactNode; as?: "section" | "div" | "article" } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      {...rest}
      className={cx("flex min-w-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3.5", className)}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13.5px] font-semibold">
      <h2 className="flex items-center gap-2">{children}</h2>
      {right}
    </div>
  );
}

export function Chip({
  on,
  onClick,
  children,
  className,
  title,
  disabled,
}: {
  on?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const cls = cx(
    "inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs whitespace-nowrap transition-colors",
    on ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface text-ink",
    onClick && !on && "hover:bg-tile",
    className,
  );
  if (!onClick) return <span className={cls}>{children}</span>;
  return (
    <button type="button" className={cls} aria-pressed={on} onClick={onClick} title={title} disabled={disabled}>
      {on && <span aria-hidden>✓</span>}
      {children}
    </button>
  );
}

export function Badge({
  tone = "accent",
  children,
  className,
}: {
  tone?: "accent" | "good" | "warn" | "muted" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    accent: "bg-accent-soft text-accent",
    good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn",
    muted: "bg-tile text-muted",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span className={cx("inline-block rounded px-1.5 py-px text-[10.5px] font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingState({ label = "불러오는 중이에요", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx("flex items-center justify-center gap-2 py-10 text-muted", className)}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      <p className="font-semibold">{title}</p>
      {description && <p className="text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cx("flex flex-col items-center gap-2 rounded-[14px] bg-danger-soft px-6 py-6 text-center text-danger", className)}>
      <p className="font-semibold">⚠ {message}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function Banner({
  tone = "warn",
  children,
  onClose,
}: {
  tone?: "warn" | "good" | "accent" | "danger";
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const tones = {
    warn: "bg-warn-soft text-warn",
    good: "bg-good-soft text-good",
    accent: "bg-accent-soft text-accent",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <div role="status" className={cx("flex items-start justify-between gap-3 rounded-[10px] px-3 py-2 text-[13px]", tones[tone])}>
      <div className="min-w-0">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="닫기" className="shrink-0 px-1 font-semibold">
          ×
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = 560,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto rounded-[14px] border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="닫기" className="px-2 text-lg text-muted">
              ×
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-[8px] border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-muted";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { code: string | number; label: string }[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(inputCls, invalid && "border-warn", className)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={String(o.code)} value={String(o.code)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function PageHeader({ title, right, sub }: { title: string; right?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-bold">{title}</h1>
        {sub && <span className="text-[13px] text-muted">{sub}</span>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Toggle membership in a list, optionally capped. */
export function toggleIn<T>(list: T[], v: T, max?: number): T[] {
  if (list.includes(v)) return list.filter((x) => x !== v);
  if (max && list.length >= max) return list;
  return [...list, v];
}
