"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Check, Clock3, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type SettingsStatusTone = "neutral" | "ok" | "attention" | "danger" | "muted"

const chipToneClass: Record<SettingsStatusTone, string> = {
  neutral: "border-white/[0.10] bg-white/[0.08] text-zinc-100",
  ok: "border-white/[0.12] bg-white/[0.10] text-zinc-100",
  attention: "border-white/[0.16] bg-white/[0.12] text-white",
  danger: "border-red-400/35 bg-red-500/10 text-red-100",
  muted: "border-white/[0.08] bg-white/[0.05] text-zinc-400",
}

export function SettingsStatusChip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode
  tone?: SettingsStatusTone
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-medium leading-none",
        chipToneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function SettingsStatusTile({
  icon: Icon,
  title,
  value,
  detail,
  chip,
  tone = "neutral",
}: {
  icon: LucideIcon
  title: string
  value: string
  detail?: string
  chip?: string
  tone?: SettingsStatusTone
}) {
  return (
    <div className="min-h-[112px] rounded-lg border border-white/[0.08] bg-white/[0.045] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-300">
          <Icon className="h-4 w-4" />
        </span>
        {chip ? <SettingsStatusChip tone={tone}>{chip}</SettingsStatusChip> : null}
      </div>
      <div className="mt-4">
        <h3 className="text-[15px] font-medium leading-5 text-zinc-50">{title}</h3>
        <p className="mt-1 text-[13px] leading-5 text-zinc-300">{value}</p>
        {detail ? <p className="mt-1 text-[12px] leading-4 text-zinc-500">{detail}</p> : null}
      </div>
    </div>
  )
}

export function SettingsSection({
  title,
  description,
  trailing,
  children,
  className,
}: {
  title: string
  description?: string
  trailing?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold leading-6 text-zinc-50">{title}</h2>
          {description ? <p className="mt-0.5 text-[12px] leading-5 text-zinc-500">{description}</p> : null}
        </div>
        {trailing}
      </div>
      <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045]">{children}</div>
    </section>
  )
}

export function SettingRow({
  icon: Icon,
  title,
  description,
  status,
  control,
  href,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  status?: ReactNode
  control?: ReactNode
  href?: string
  className?: string
}) {
  const content = (
    <>
      {Icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-400">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-medium leading-5 text-zinc-50">{title}</h3>
          {status}
        </div>
        {description ? <p className="mt-1 text-[12px] leading-5 text-zinc-500">{description}</p> : null}
      </div>
      {control}
    </>
  )

  const rowClass = cn(
    "flex min-h-[56px] items-center gap-3 border-b border-white/[0.07] px-4 py-3 last:border-b-0",
    href && "transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
    className,
  )

  if (href) {
    return (
      <Link href={href} prefetch={false} className={rowClass}>
        {content}
      </Link>
    )
  }

  return <div className={rowClass}>{content}</div>
}

export function ConnectionRow({
  icon,
  title,
  description,
  status,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  status?: ReactNode
  action?: ReactNode
}) {
  return (
    <SettingRow
      icon={icon}
      title={title}
      description={description}
      status={status}
      control={action}
    />
  )
}

export function DangerZone({
  title = "危険な操作",
  description,
  children,
}: {
  title?: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-red-400/25 bg-red-500/[0.04] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-400/25 bg-red-500/10 text-red-200">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-red-100">{title}</h2>
          {description ? <p className="mt-1 text-[12px] leading-5 text-red-100/70">{description}</p> : null}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  )
}

export function SaveStateText({ state }: { state: "idle" | "saving" | "saved" | "failed" }) {
  if (state === "idle") return null
  const map = {
    saving: { icon: Loader2, label: "保存中", className: "text-zinc-400" },
    saved: { icon: Check, label: "保存済み", className: "text-zinc-300" },
    failed: { icon: AlertTriangle, label: "保存失敗", className: "text-red-200" },
  } as const
  const item = map[state]
  const Icon = item.icon

  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px]", item.className)}>
      <Icon className={cn("h-3.5 w-3.5", state === "saving" && "animate-spin")} />
      {item.label}
    </span>
  )
}

export function SettingsEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[88px] items-center justify-center px-4 py-6 text-center text-[13px] text-zinc-500">
      <Clock3 className="mr-2 h-4 w-4" />
      {children}
    </div>
  )
}
