'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useState } from 'react'
import { useAuth } from '@/lib/auth-context'

export default function RegisterPage() {
  const router = useRouter()
  const { register } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [warehouseName, setWarehouseName] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await register({
        org_name: orgName,
        warehouse_name: warehouseName || undefined,
        name: name || undefined,
        email,
        password,
      })
      router.replace('/recommendations')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося створити організацію.')
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
        <h1 className="text-2xl font-semibold text-slate-900">Реєстрація організації</h1>
        <label className="block text-sm text-slate-500">
          Назва компанії *
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-slate-500">
          Назва складу
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            value={warehouseName}
            onChange={(e) => setWarehouseName(e.target.value)}
            placeholder="Основний склад"
          />
        </label>
        <label className="block text-sm text-slate-500">
          Ім’я адміністратора
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Адміністратор"
          />
        </label>
        <label className="block text-sm text-slate-500">
          Email *
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-slate-500">
          Пароль (мін. 6 символів) *
          <input
            className="mt-1 w-full rounded-lg border border-slate-200 p-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-indigo-600 py-2 text-white transition hover:bg-indigo-500 disabled:bg-slate-400"
        >
          {isSubmitting ? 'Реєстрація...' : 'Зареєструватися'}
        </button>
        <p className="text-xs text-slate-500">
          Вже є акаунт?{' '}
          <Link href="/login" className="text-indigo-600 hover:underline">
            Увійдіть
          </Link>
        </p>
      </form>
    </main>
  )
}
