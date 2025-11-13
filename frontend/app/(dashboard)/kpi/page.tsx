'use client'

import { useAuth } from '@/lib/auth-context'
import { fetchSkuKpi } from '@/lib/api-client'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const WAREHOUSES = [
  { id: 'WH-KYIV', label: 'Київський хаб' },
  { id: 'WH-LVIV', label: 'Львівський склад' },
  { id: 'WH-KHARKIV', label: 'Харківський РЦ' },
  { id: 'WH-ODESA', label: 'Одеський сервісний центр' },
]

const DEFAULT_SKUS = ['SKU-001', 'SKU-025', 'SKU-050', 'SKU-075', 'SKU-100']

export default function KpiPage() {
  const router = useRouter()
  const { token, loading } = useAuth()
  const [warehouseId, setWarehouseId] = useState(WAREHOUSES[0].id)
  const [sku, setSku] = useState(DEFAULT_SKUS[0])
  const [range, setRange] = useState(() => ({
    from: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  }))

  useEffect(() => {
    if (!loading && !token) {
      router.replace('/login')
    }
  }, [loading, token, router])

  const query = useQuery({
    queryKey: ['kpi', sku, warehouseId, range],
    queryFn: () => {
      if (!token) throw new Error('unauthorized')
      return fetchSkuKpi(token, sku, {
        warehouseId,
        from: range.from,
        to: range.to,
      })
    },
    enabled: !!token && !loading,
  })

  const metrics = query.data?.metrics

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">KPI складу</h1>
          <p className="mt-2 text-slate-600">
            Дані з API: Days of Supply, Turns, median days-to-sell та FEFO ризики.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={sku}
            onChange={(event) => setSku(event.target.value)}
          >
            {DEFAULT_SKUS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            {WAREHOUSES.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={range.from}
            onChange={(event) => setRange((prev) => ({ ...prev, from: event.target.value }))}
          />
          <input
            type="date"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={range.to}
            onChange={(event) => setRange((prev) => ({ ...prev, to: event.target.value }))}
          />
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Days of Supply"
          value={
            query.isLoading
              ? '...'
              : metrics?.dos !== null && metrics?.dos !== undefined
                ? `${metrics.dos.toFixed(1)} днів`
                : '—'
          }
        />
        <MetricCard
          label="Turns"
          value={
            query.isLoading
              ? '...'
              : metrics
                ? `${metrics.turns.toFixed(1)} / рік`
                : '—'
          }
        />
        <MetricCard
          label="Median Days-to-Sell"
          value={
            query.isLoading
              ? '...'
              : metrics?.median_days_to_sell
                ? `${metrics.median_days_to_sell} дн.`
                : '—'
          }
        />
        <MetricCard
          label="FEFO ризик"
          value={
            query.isLoading
              ? '...'
              : metrics
                ? metrics.fefo_risk
                  ? '⚠️ Так'
                  : 'Ок'
                : '—'
          }
        />
      </section>

      {query.isError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {(query.error as Error).message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800">Деталі</h2>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li>SKU: {sku}</li>
          <li>Склад: {warehouseId}</li>
          <li>
            Період: {range.from} — {range.to}
          </li>
          <li>On hand: {metrics?.on_hand ?? '—'}</li>
          <li>Середній денний попит: {metrics?.avg_daily_demand ?? '—'}</li>
        </ul>
      </section>
    </main>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  )
}
