'use client'

import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useMemo } from 'react'

const AUTH_LINKS = [
  { href: '/import', label: 'Імпорт даних', description: 'Завантаж CSV/JSON на сервер' },
  { href: '/recommendations', label: 'Рекомендації', description: 'ТОС-буфери та плани замовлень' },
  { href: '/kpi', label: 'KPI', description: 'DoS, оборотність, FEFO' },
  { href: '/assistant', label: 'AI-асистент', description: 'Запитання природною мовою' },
]

export default function HomePage() {
  const { token, loading } = useAuth()

  const heroDescription = useMemo(
    () =>
      token
        ? 'Оберіть розділ, щоб побачити реальні дані складу. Рекомендації, KPI та AI вже підключені до бекенду.'
        : 'Увійдіть, щоб завантажити дані складу, бачити рекомендації та спілкуватись з AI-асистентом.',
    [token],
  )

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <section className="space-y-4">
        <p className="text-sm uppercase tracking-widest text-slate-500">ТОС + AI</p>
        <h1 className="text-4xl font-semibold text-slate-900">Warehouse Assistant</h1>
        <p className="max-w-3xl text-lg text-slate-600">{heroDescription}</p>
        {!token && !loading && (
          <div className="flex flex-wrap gap-3">
            <Link
              href="/login"
              className="inline-flex items-center rounded-full bg-indigo-600 px-6 py-2 text-sm font-semibold text-white shadow transition hover:bg-indigo-500"
            >
              Увійти
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center rounded-full border border-indigo-200 px-6 py-2 text-sm font-semibold text-indigo-700 transition hover:border-indigo-300"
            >
              Зареєструватися
            </Link>
          </div>
        )}
      </section>

      {token && (
        <section className="grid gap-4 sm:grid-cols-2">
          {AUTH_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-indigo-400 hover:shadow-md"
            >
              <h2 className="text-xl font-semibold text-slate-800">{link.label}</h2>
              <p className="mt-2 text-sm text-slate-500">{link.description}</p>
            </Link>
          ))}
        </section>
      )}
    </main>
  )
}
