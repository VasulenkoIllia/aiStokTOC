'use client'

import { useAuth } from '@/lib/auth-context'
import { ingestPayload } from '@/lib/api-client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const feedTypes = [
  { id: 'catalog', label: 'Каталог' },
  { id: 'sales_report', label: 'Продажі' },
  { id: 'stock', label: 'Залишки' },
  { id: 'po_header', label: 'PO Header' },
  { id: 'po_lines', label: 'PO Lines' },
  { id: 'warehouses', label: 'Склади' },
  { id: 'suppliers', label: 'Постачальники' },
]

export default function ImportPage() {
  const [selectedFeed, setSelectedFeed] = useState(feedTypes[0].id)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const router = useRouter()
  const { token, loading } = useAuth()

  useEffect(() => {
    if (!loading && !token) {
      router.replace('/login')
    }
  }, [loading, token, router])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null
    setFile(nextFile)
    setStatus(null)
  }

  const handleUpload = async () => {
    if (!file || !token) return
    setStatus(null)
    setIsUploading(true)
    try {
      const text = await file.text()
      if (!file.name.endsWith('.json')) {
        throw new Error('Поки що підтримуємо лише JSON-файли для демо.')
      }
      const payload = JSON.parse(text)
      await ingestPayload(token, selectedFeed as any, payload)
      setStatus('Дані імпортовано успішно.')
      setFile(null)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не вдалося імпортувати файл.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">Імпорт даних</h1>
        <p className="mt-2 text-slate-600">
          Завантаж JSON-файл із ключем `items` (див. `docs/integration-spec.md`). На проді файл
          генерує 1С, а тут можна тестувати вручну.
        </p>
      </header>

      <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 shadow-sm">
        <label className="text-sm font-medium text-slate-700">Тип фіда</label>
        <select
          className="mt-2 w-full rounded-lg border border-slate-200 p-2"
          value={selectedFeed}
          onChange={(event) => setSelectedFeed(event.target.value)}
        >
          {feedTypes.map((feed) => (
            <option key={feed.id} value={feed.id}>
              {feed.label}
            </option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium text-slate-700">
          JSON-файл
          <input
            className="mt-2 w-full rounded-lg border border-slate-200 p-2"
            type="file"
            accept=".json"
            onChange={handleFileChange}
          />
        </label>

        <button
          type="button"
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-500 disabled:bg-slate-400"
          onClick={handleUpload}
          disabled={!file || isUploading}
        >
          {isUploading ? 'Завантаження...' : 'Завантажити'}
        </button>

        {status && <p className="mt-3 text-sm text-slate-600">{status}</p>}
      </section>
    </main>
  )
}
