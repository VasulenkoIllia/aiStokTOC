'use client'

import Link from 'next/link'
import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

type AppShellProps = {
  children: ReactNode
}

const NAV_LINKS = [
  { href: '/', label: 'Головна' },
  { href: '/recommendations', label: 'Рекомендації' },
  { href: '/kpi', label: 'KPI' },
  { href: '/import', label: 'Імпорт' },
  { href: '/assistant', label: 'AI-асистент' },
  { href: '/settings', label: 'Налаштування' },
]

const AUTH_ROUTES = ['/login', '/register']
const PUBLIC_ROUTES = ['/login', '/register']

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, token, logout, loading } = useAuth()

  const isAuthRoute = AUTH_ROUTES.includes(pathname)
  const isPublic = PUBLIC_ROUTES.includes(pathname)

  useEffect(() => {
    if (!loading && !token && !isPublic) {
      router.replace('/login')
    }
  }, [loading, token, isPublic, router])

  if (isAuthRoute) {
    return <>{children}</>
  }

  if (loading || (!token && !isPublic)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-slate-600 shadow-sm">
          Завантаження...
        </div>
      </div>
    )
  }

  const handleLogout = () => {
    logout()
    router.replace('/login')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              Warehouse Assistant
            </Link>
            <div className="hidden gap-4 text-sm text-slate-600 md:flex">
              {NAV_LINKS.map((link) => {
                const active = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-full px-3 py-1 transition ${
                      active
                        ? 'bg-indigo-100 text-indigo-700'
                        : 'hover:text-slate-900'
                    }`}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <div className="text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{user.email}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{user.role}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                >
                  Вийти
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                Увійти
              </Link>
            )}
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">{children}</div>
    </div>
  )
}
