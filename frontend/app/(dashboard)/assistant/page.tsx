'use client'

import { useAuth } from '@/lib/auth-context'
import { assistantQuery } from '@/lib/api-client'
import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
}

const initialMessages: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'Привіт! Я AI-асистент складу. Запитай про SKU, буфери чи KPI.',
  },
]

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const router = useRouter()
  const { token, loading } = useAuth()

  useEffect(() => {
    if (!loading && !token) {
      router.replace('/login')
    }
  }, [loading, token, router])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!input.trim() || !token) return
    const text = input.trim()
    setInput('')
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text }
    setMessages((prev) => [...prev, userMessage])
    setIsSending(true)
    try {
      const response = await assistantQuery(token, text)
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: response.answer,
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: error instanceof Error ? error.message : 'Не вдалося отримати відповідь.',
        },
      ])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">AI-асистент складу</h1>
        <p className="mt-2 text-slate-600">
          Запитай природною мовою: «Які топові SKU за 30 днів?», «Покажи продажі 2025-01-10 по WH-KYIV»,
          «Поясни буфер SKU-050».
        </p>
      </header>

      <section className="flex flex-1 flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex-1 space-y-4 overflow-y-auto">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-xl rounded-2xl px-4 py-3 text-sm ${
                msg.role === 'assistant'
                  ? 'bg-indigo-50 text-slate-800'
                  : 'ml-auto bg-slate-900 text-white'
              }`}
            >
              {msg.text}
            </div>
          ))}
          {isSending && (
            <div className="max-w-xl rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-slate-500">
              Асистент думає...
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-2"
            placeholder="Запитай, наприклад: «Чому для SKU-001 20 штук?»"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="rounded-2xl bg-indigo-600 px-6 py-2 text-white hover:bg-indigo-500 disabled:bg-slate-400"
          >
            Надіслати
          </button>
        </form>
      </section>
    </main>
  )
}
