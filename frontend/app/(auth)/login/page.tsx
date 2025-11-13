'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const { login } = useAuth()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await login(email, password)
      router.replace('/recommendations')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося увійти')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-lg"
      >
        <h1 className="text-2xl font-semibold text-slate-900">Вхід до Warehouse Assistant</h1>
        <label className="block text-sm text-slate-500">
          Email
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-slate-500">
          Пароль
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-indigo-600 py-2 text-white transition hover:bg-indigo-500 disabled:bg-slate-400"
        >
          {isSubmitting ? 'Вхід...' : 'Увійти'}
        </button>
        <p className="text-xs text-slate-500">
          Демо-доступ: demo@warehouse.ai / Demo1234!
        </p>
        <p className="text-xs text-slate-500">
          Немає акаунта?{' '}
          <Link href="/register" className="text-indigo-600 hover:underline">
            Зареєструйтесь
          </Link>
        </p>
      </form>
    </main>
  )
}
