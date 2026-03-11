"use client"

import React, { useCallback, useContext, useEffect, useState } from "react"
import { installAuthFetchPatch } from "@/lib/auth-client"

export interface ThemeSettings {
  primary_color: string
  button_color: string
  logo_url: string | null
  company_name: string
}

interface ThemeContextType {
  theme: ThemeSettings | null
  loading: boolean
  refetch: () => void
}

const defaultTheme: ThemeSettings = {
  primary_color: "#1c5026",
  button_color: "#1c5026",
  logo_url: null,
  company_name: "NZI",
}

const ThemeContext = React.createContext<ThemeContextType>({
  theme: defaultTheme,
  loading: true,
  refetch: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [authReady, setAuthReady] = useState(false)

  const candidateApiBases = (): string[] => {
    const out: string[] = []
    out.push("/api/backend")
    if (typeof window !== "undefined") {
      const host = window.location.hostname || "localhost"
      out.push(`http://${host}:8002`)
      out.push(`http://${host}:8000`)
    }
    const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim()
    if (envBase) out.push(envBase)
    out.push("http://127.0.0.1:8002")
    out.push("http://localhost:8000")
    return Array.from(new Set(out))
  }

  const fetchTheme = useCallback(async () => {
    try {
      const bases = candidateApiBases()
      let response: Response | null = null
      for (const base of bases) {
        try {
          const res = await fetch(`${base}/theme-settings`, { credentials: "include" })
          if (res.ok) {
            response = res
            break
          }
        } catch {
          // Try next candidate base.
        }
      }

      if (!response) {
        setTheme(defaultTheme)
        return
      }

      const data = await response.json()
      const settings = data.settings || {}
      setTheme({
        primary_color: settings.primary_color?.value || defaultTheme.primary_color,
        button_color: settings.button_color?.value || defaultTheme.button_color,
        logo_url: settings.logo_url?.value || defaultTheme.logo_url,
        company_name: settings.company_name?.value || defaultTheme.company_name,
      })
    } catch (error) {
      console.error("Failed to fetch theme settings:", error)
      setTheme(defaultTheme)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    installAuthFetchPatch()
    setAuthReady(true)
  }, [])

  useEffect(() => {
    if (!authReady) return
    fetchTheme()
  }, [authReady, fetchTheme])

  return (
    <ThemeContext.Provider value={{ theme, loading, refetch: fetchTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
