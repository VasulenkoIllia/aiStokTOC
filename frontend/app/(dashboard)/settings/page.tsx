'use client'

import { useAuth } from '@/lib/auth-context'
import { fetchApiKey, rotateApiKey } from '@/lib/api-client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function SettingsPage() {
  const { token, loading } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!loading && !token) {
      router.replace('/login')
    }
  }, [loading, token, router])

  const apiKeyQuery = useQuery({
    queryKey: ['api-key'],
    queryFn: () => {
      if (!token) throw new Error('unauthorized')
      return fetchApiKey(token)
    },
    enabled: !!token && !loading,
  })

  const handleRotate = async () => {
    if (!token) return
    await rotateApiKey(token)
    await queryClient.invalidateQueries({ queryKey: ['api-key'] })
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">Налаштування API</h1>
        <p className="mt-2 text-slate-600">
          Використовуйте API ключ для інтеграцій (SFTP/webhook/конектор). Додавайте його в заголовок
          `X-API-Key` при викликах `/api/ingest/*`.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-700">Поточний API ключ</p>
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-900">
          {apiKeyQuery.isLoading && 'Завантаження...'}
          {apiKeyQuery.isError && (
            <span className="text-red-600">{(apiKeyQuery.error as Error).message}</span>
          )}
          {apiKeyQuery.data?.api_key}
        </div>
        <button
          type="button"
          onClick={handleRotate}
          className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300"
          disabled={apiKeyQuery.isLoading}
        >
          Згенерувати новий ключ
        </button>
      </section>
    </main>
  )
}
