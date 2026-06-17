"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, LogOut, UserRound } from "lucide-react"
import { createClient } from "@/utils/supabase/client"
import { cn } from "@/lib/utils"

type AccountUser = {
  email: string | null
  name: string | null
}

function initialFor(user: AccountUser) {
  const source = user.name || user.email || "F"
  return source.trim().slice(0, 1).toUpperCase()
}

export function SettingsAccountMenu({ className }: { className?: string }) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [user, setUser] = useState<AccountUser>({ email: null, name: null })

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      const metadata = data.user?.user_metadata
      setUser({
        email: data.user?.email ?? null,
        name:
          (typeof metadata?.full_name === "string" && metadata.full_name) ||
          (typeof metadata?.name === "string" && metadata.name) ||
          null,
      })
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  const displayName = useMemo(() => user.name || user.email?.split("@")[0] || "Focusmap", [user])
  const email = user.email || "ログイン中"

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await createClient().auth.signOut()
      router.push("/login")
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.055] px-3 text-left transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.10] text-[14px] font-medium text-zinc-100">
          {initialFor(user)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4 text-zinc-100">{displayName}</span>
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-zinc-500">{email}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-full overflow-hidden rounded-lg border border-white/[0.10] bg-[#171717] p-1 shadow-2xl shadow-black/40"
        >
          <Link
            href="/dashboard/settings/access#account"
            prefetch={false}
            role="menuitem"
            className="flex min-h-11 items-center gap-2 rounded-md px-3 text-[13px] text-zinc-200 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
            onClick={() => setOpen(false)}
          >
            <UserRound className="h-4 w-4 text-zinc-400" />
            アカウント設定
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <LogOut className="h-4 w-4 text-zinc-400" />
            {signingOut ? "ログアウト中" : "ログアウト"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
