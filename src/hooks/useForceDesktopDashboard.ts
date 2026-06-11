"use client"

import { useEffect, useState } from "react"

const STORAGE_KEY = "focusmap:force-desktop-dashboard"

function readForceDesktopDashboard(): boolean {
    if (typeof window === "undefined") return false

    const params = new URLSearchParams(window.location.search)
    const queryValue = params.get("desktop") ?? params.get("pc")

    if (queryValue === "1" || queryValue === "true") {
        try { window.localStorage.setItem(STORAGE_KEY, "true") } catch {}
        return true
    }

    if (queryValue === "0" || queryValue === "false") {
        try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
        return false
    }

    try {
        return window.localStorage.getItem(STORAGE_KEY) === "true"
    } catch {
        return false
    }
}

export function useForceDesktopDashboard(): boolean {
    const [forceDesktop, setForceDesktop] = useState(false)

    useEffect(() => {
        const update = () => setForceDesktop(readForceDesktopDashboard())

        update()
        window.addEventListener("popstate", update)
        return () => window.removeEventListener("popstate", update)
    }, [])

    useEffect(() => {
        let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
        if (!viewport) {
            viewport = document.createElement("meta")
            viewport.name = "viewport"
            document.head.appendChild(viewport)
        }

        viewport.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    }, [])

    return forceDesktop
}
