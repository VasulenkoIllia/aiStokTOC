'use client'

import { useAuth } from '@/lib/auth-context'
import {
  fetchRecommendations,
  fetchWarehouses,
  type RecommendationsResponse,
} from '@/lib/api-client'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

const zoneClasses: Record<string, string> = {
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  green: 'bg-emerald-100 text-emerald-800',
}

type RecommendationRow = {
  sku: string
  category?: string | null
  name: string
  segment: 'A' | 'B' | 'C'
  zone: string
  target: number
  onHand: number
  inbound: number
  suggestedQty: number
  reason: string
  overstock?: {
    ratio: number
    message: string
  }
  avgDailyDemand: number
  leadTimeDays: number
  daysOfSupply: number | null
  bufferPenetration: number | null
  monthlyDemand: number
}

type Filters = {
  search: string
  category: string
  segment: string
  zone: string
  overstock: string
}

type SortConfig = {
  field: 'target' | 'onHand' | 'monthlyDemand' | 'inbound' | 'suggestedQty'
  direction: 'asc' | 'desc'
}

type WarehouseRecommendationResponse = RecommendationsResponse & {
  warehouseName: string
}

export default function RecommendationsPage() {
  const [warehouseId, setWarehouseId] = useState<string>()
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [filters, setFilters] = useState<Filters>({
    search: '',
    category: 'ALL',
    segment: 'ALL',
    zone: 'ALL',
    overstock: 'ALL',
  })
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'target',
    direction: 'desc',
  })
  const router = useRouter()
  const { token, loading } = useAuth()

  useEffect(() => {
    if (!loading && !token) {
      router.replace('/login')
    }
  }, [loading, token, router])

  const warehousesQuery = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => {
      if (!token) throw new Error('unauthorized')
      return fetchWarehouses(token)
    },
    enabled: !!token && !loading,
  })

  const availableWarehouses = warehousesQuery.data?.data ?? []
  const warehousesKey = useMemo(
    () => availableWarehouses.map((wh) => wh.id).sort().join('|'),
    [availableWarehouses],
  )

  useEffect(() => {
    if (!warehouseId && availableWarehouses.length > 0) {
      const first = availableWarehouses[0]
      setWarehouseId(first.id)
      if (first.latestStockDate) {
        setDate(format(new Date(first.latestStockDate), 'yyyy-MM-dd'))
      }
    }
  }, [availableWarehouses, warehouseId])

  const query = useQuery({
    queryKey: ['recommendations', warehouseId, date, page, pageSize],
    queryFn: () => {
      if (!token || !warehouseId) throw new Error('unauthorized')
      return fetchRecommendations(token, {
        warehouseId,
        date,
        page,
        pageSize,
      })
    },
    keepPreviousData: true,
    enabled: !!token && !loading && !!warehouseId,
  })

  const rows: RecommendationRow[] = query.data?.data ?? []
  const total = query.data?.total ?? 0
  const effectiveDate = query.data?.effective_date ?? null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const networkSearchTerm = filters.search.trim()
  const networkPageSize = networkSearchTerm ? 200 : 100

  const networkQuery = useQuery({
    queryKey: ['recommendations-network', date, warehousesKey, networkPageSize],
    queryFn: async () => {
      if (!token) throw new Error('unauthorized')
      if (!availableWarehouses.length) return []
      const responses = await Promise.all(
        availableWarehouses.map(async (wh) => {
          const result = await fetchRecommendations(token, {
            warehouseId: wh.id,
            date,
            page: 1,
            pageSize: networkPageSize,
          })
          return { ...result, warehouseName: wh.name }
        }),
      )
      return responses
    },
    enabled: !!token && !loading && availableWarehouses.length > 0,
    staleTime: 60_000,
  })

  const aggregatedResponses = (networkQuery.data ??
    []) as WarehouseRecommendationResponse[]

  const categoryOptions = useMemo(() => {
    const set = new Set(
      rows
        .map((row) => row.category)
        .filter((value): value is string => Boolean(value)),
    )
    return Array.from(set)
  }, [rows])

  const segmentOptions = useMemo(() => {
    const set = new Set(rows.map((row) => row.segment))
    return Array.from(set)
  }, [rows])

  const filteredRows = applyFilters(rows, filters)
  const sortedRows = applySorting(filteredRows, sortConfig)
  const noWarehouses = !warehousesQuery.isLoading && availableWarehouses.length === 0

  const searchTerm = filters.search.trim()

  const globalSummary = useMemo(() => {
    if (!aggregatedResponses.length) return null
    const totals = aggregatedResponses.reduce(
      (acc, resp) => {
        resp.data.forEach((row) => {
          acc.onHand += row.onHand
          acc.target += row.target
          acc.suggested += row.suggestedQty
          if (row.zone === 'red') acc.red += 1
          if (row.overstock) acc.overstock += 1
        })
        acc.rows += resp.data.length
        return acc
      },
      { onHand: 0, target: 0, suggested: 0, red: 0, rows: 0, overstock: 0 },
    )
    return {
      warehouses: aggregatedResponses.length,
      skuRows: totals.rows,
      onHand: totals.onHand,
      target: totals.target,
      suggested: totals.suggested,
      red: totals.red,
      overstock: totals.overstock,
    }
  }, [aggregatedResponses])

  const networkMatches = useMemo(() => {
    if (!searchTerm) return []
    const lowered = searchTerm.toLowerCase()
    return aggregatedResponses.flatMap((resp) =>
      resp.data
        .filter(
          (row) =>
            row.sku.toLowerCase().includes(lowered) ||
            row.name.toLowerCase().includes(lowered) ||
            row.reason.toLowerCase().includes(lowered),
        )
        .map((row) => ({
          ...row,
          warehouseId: resp.warehouse_id,
          warehouseName: resp.warehouseName,
        })),
    )
  }, [aggregatedResponses, searchTerm])

  const networkMatchSummary = useMemo(() => {
    if (!networkMatches.length) return null
    const totals = networkMatches.reduce(
      (acc, row) => {
        acc.onHand += row.onHand
        acc.suggested += row.suggestedQty
        acc.inbound += row.inbound
        acc.target += row.target
        acc.warehouses.add(row.warehouseId)
        return acc
      },
      {
        onHand: 0,
        suggested: 0,
        inbound: 0,
        target: 0,
        warehouses: new Set<string>(),
      },
    )
    return {
      warehouseCount: totals.warehouses.size,
      onHand: totals.onHand,
      suggested: totals.suggested,
      inbound: totals.inbound,
      target: totals.target,
      rows: networkMatches.length,
    }
  }, [networkMatches])

  const handleWarehouseCardClick = useCallback(
    (targetWarehouseId: string) => {
      setWarehouseId(targetWarehouseId)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [setWarehouseId],
  )

  if (noWarehouses) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-16">
        <header className="space-y-2 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Рекомендації</p>
          <h1 className="text-3xl font-semibold text-slate-900">Додайте склади, щоб побачити аналітику</h1>
          <p className="text-base text-slate-600">
            Система очікує принаймні один склад із завантаженими залишками / продажами. Імпортуйте CSV / DBF або
            створіть склад вручну в адмінці.
          </p>
        </header>
        <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-600">
          <p>Після імпорту дані зʼявляться автоматично. Використовуйте API ключ організації для передачі файлів.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Рекомендації до замовлення</h1>
          <p className="mt-2 text-slate-600">
            Дані беруться з ТОС-буферів: зона, ціль, залишок, inbound та рекомендований заказ.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={warehouseId ?? ''}
            onChange={(event) => {
              setWarehouseId(event.target.value || undefined)
              setPage(1)
            }}
            disabled={!availableWarehouses.length}
          >
            {!availableWarehouses.length && <option value="">Немає складів</option>}
            {availableWarehouses.map((wh) => (
              <option key={wh.id} value={wh.id}>
                {wh.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      </header>

      <section className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <input
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm md:w-64"
          placeholder="Пошук за SKU або поясненням"
          value={filters.search}
          onChange={(event) => {
            setFilters((prev) => ({ ...prev, search: event.target.value }))
            setPage(1)
          }}
        />
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filters.category}
          onChange={(event) => {
            setFilters((prev) => ({ ...prev, category: event.target.value }))
            setPage(1)
          }}
        >
          <option value="ALL">Всі категорії</option>
          {categoryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filters.segment}
          onChange={(event) => {
            setFilters((prev) => ({ ...prev, segment: event.target.value }))
            setPage(1)
          }}
        >
          <option value="ALL">Всі сегменти</option>
          {segmentOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filters.zone}
          onChange={(event) => {
            setFilters((prev) => ({ ...prev, zone: event.target.value }))
            setPage(1)
          }}
        >
          <option value="ALL">Всі зони</option>
          <option value="red">Red</option>
          <option value="yellow">Yellow</option>
          <option value="green">Green</option>
        </select>
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          value={filters.overstock}
          onChange={(event) => {
            setFilters((prev) => ({ ...prev, overstock: event.target.value }))
            setPage(1)
          }}
        >
          <option value="ALL">Overstock: всі</option>
          <option value="only">Тільки з надлишком</option>
          <option value="none">Без надлишку</option>
        </select>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">
            Сортувати за:
            <select
              className="ml-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={sortConfig.field}
              onChange={(event) =>
                setSortConfig((prev) => ({ ...prev, field: event.target.value as SortConfig['field'] }))
              }
            >
              <option value="target">Target</option>
              <option value="onHand">On hand</option>
              <option value="monthlyDemand">Місячний попит</option>
              <option value="inbound">Inbound</option>
              <option value="suggestedQty">Suggested</option>
            </select>
          </label>
          <select
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={sortConfig.direction}
            onChange={(event) =>
              setSortConfig((prev) => ({ ...prev, direction: event.target.value as SortConfig['direction'] }))
            }
          >
            <option value="desc">За спаданням</option>
            <option value="asc">За зростанням</option>
          </select>
        </div>
        <p className="w-full text-sm text-slate-500">
          *Фільтри застосовуються до поточної сторінки. Використовуйте пошук + пагінацію для уточнення.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <p className="font-semibold text-slate-900">Як читати таблицю</p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div>
            <p>
              <span className="font-semibold text-slate-800">Категорія</span> — поле з довідника
              <code className="mx-1">catalog.category</code>, яке групує SKU за товарними сімействами.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Зона</span> =
              <code className="mx-1">(on_hand + inbound - reservations) / buffer_qty</code>. Red означає дефіцит,
              Yellow — час планувати поповнення, Green — запас у межах норми.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Target</span> =
              <code className="mx-1">avg_daily_demand × lead_time_days × buffer_factor</code>, де
              <code className="mx-1">avg_daily_demand</code> рахується зі `sales_daily` (60 днів),
              <code className="mx-1">lead_time_days</code> — медіана поставок, а
              <code className="mx-1">buffer_factor</code> — коефіцієнт безпеки.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">On hand</span> — підсумок
              <code className="mx-1">stock_snapshots.qty_on_hand</code> за вибраний день.
            </p>
          </div>
          <div>
            <p>
              <span className="font-semibold text-slate-800">Inbound</span> — підтверджені замовлення постачальникам, які
              ще не отримані.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Suggested</span> =
              <code className="mx-1">ceil_to_pack(max(0, target - stock_position))</code>, де
              <code className="mx-1">stock_position = on_hand + inbound - reservations</code>.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Overstock</span> — сигнал, якщо
              <code className="mx-1">on_hand &gt; avg_daily_demand × 30 × 1.1</code>.
            </p>
            <p className="mt-1">
              <span className="font-semibold text-slate-800">Показники</span>: сегмент ABC, середній денний попит,
              місячний попит, lead time, DoS та буферне проникнення.
            </p>
          </div>
        </div>
      </section>

      {availableWarehouses.length > 1 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Вся мережа складів</h2>
              <p className="text-sm text-slate-600">
                Допомагає розставити пріоритети: де критичні дефіцити, а де надлишки.
              </p>
            </div>
            {globalSummary && (
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                <div>
                  <span className="font-semibold text-slate-900">{globalSummary.warehouses}</span>{' '}
                  складів
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    {globalSummary.onHand.toLocaleString()}
                  </span>{' '}
                  on hand
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    {globalSummary.suggested.toLocaleString()}
                  </span>{' '}
                  рекомендовано
                </div>
                <div>
                  <span className="font-semibold text-red-600">{globalSummary.red}</span> SKU у
                  червоній зоні
                </div>
                <div>
                  <span className="font-semibold text-amber-700">{globalSummary.overstock}</span>{' '}
                  SKU із надлишком
                </div>
              </div>
            )}
          </header>
          {networkQuery.isLoading && (
            <p className="mt-4 text-sm text-slate-500">Збираємо дані по складах…</p>
          )}
          {networkQuery.error && (
            <p className="mt-4 text-sm text-red-600">
              {(networkQuery.error as Error).message}
            </p>
          )}
          {!networkQuery.isLoading && !aggregatedResponses.length && (
            <p className="mt-4 text-sm text-slate-500">
              Дані мережі ще не готові. Спробуйте оновити сторінку або імпортуйте залишки/продажі.
            </p>
          )}
          {!!aggregatedResponses.length && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {aggregatedResponses.map((resp) => {
                const onHandTotal = resp.data.reduce((sum, row) => sum + row.onHand, 0)
                const suggestedTotal = resp.data.reduce(
                  (sum, row) => sum + row.suggestedQty,
                  0,
                )
                const redCount = resp.data.filter((row) => row.zone === 'red').length
                const overstockCount = resp.data.filter((row) => row.overstock).length
                return (
                  <button
                    key={resp.warehouse_id}
                    type="button"
                    onClick={() => handleWarehouseCardClick(resp.warehouse_id)}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left shadow-sm transition hover:border-indigo-300 hover:bg-white"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-semibold text-slate-900">{resp.warehouseName}</p>
                        <p className="text-xs text-slate-500">
                          SKU на сторінці {resp.data.length} / {resp.total}
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">
                        Перейти
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-xs text-slate-600 md:grid-cols-4">
                      <div>
                        <dt className="text-slate-500">On hand</dt>
                        <dd className="font-semibold text-slate-900">
                          {onHandTotal.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Suggested</dt>
                        <dd className="font-semibold text-indigo-700">
                          {suggestedTotal.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Red</dt>
                        <dd className="font-semibold text-red-600">{redCount}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Overstock</dt>
                        <dd className="font-semibold text-amber-700">{overstockCount}</dd>
                      </div>
                    </dl>
                    <p className="text-sm text-slate-600">{buildWarehouseInsight(resp)}</p>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {searchTerm && (
        <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Пошук SKU по мережі: «{searchTerm}»
              </h2>
              <p className="text-sm text-slate-600">
                Показує всі склади, де знайдено відповідність по SKU, назві або поясненню причини.
              </p>
            </div>
            {networkMatchSummary && (
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                <div>
                  <span className="font-semibold text-slate-900">
                    {networkMatchSummary.warehouseCount}
                  </span>{' '}
                  складів
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    {networkMatchSummary.onHand.toLocaleString()}
                  </span>{' '}
                  on hand
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    {networkMatchSummary.suggested.toLocaleString()}
                  </span>{' '}
                  рекомендовано
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    {networkMatchSummary.rows}
                  </span>{' '}
                  рядків
                </div>
              </div>
            )}
          </header>
          {networkQuery.isLoading && (
            <p className="mt-4 text-sm text-slate-500">Шукаємо відповідності по складах…</p>
          )}
          {!networkQuery.isLoading && networkMatches.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">
              SKU «{searchTerm}» не знайдено на інших складах у видимому діапазоні.
            </p>
          )}
          {!!networkMatches.length && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    {[
                      'Склад',
                      'SKU',
                      'Назва',
                      'Зона',
                      'Target',
                      'On hand',
                      'Inbound',
                      'Suggested',
                      'Reason',
                    ].map((col) => (
                      <th key={col} className="px-4 py-3 text-left font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {networkMatches.map((row) => (
                    <tr key={`${row.warehouseId}-${row.sku}`}>
                      <td className="px-4 py-3 text-slate-900">{row.warehouseName}</td>
                      <td className="px-4 py-3 font-mono text-slate-900">{row.sku}</td>
                      <td className="px-4 py-3 text-slate-600">{row.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            zoneClasses[row.zone] ?? 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {row.zone.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3">{row.target}</td>
                      <td className="px-4 py-3">{row.onHand}</td>
                      <td className="px-4 py-3">{row.inbound}</td>
                      <td className="px-4 py-3 text-indigo-700">{row.suggestedQty}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          Склад: <span className="font-semibold text-slate-900">{warehouseId}</span>. На сторінці{' '}
          {filteredRows.length} / {pageSize} позицій (усього {total.toLocaleString()} SKU).
          {effectiveDate && (
            <span className="mt-1 block text-xs text-slate-500">
              Дані станом на {effectiveDate}
              {effectiveDate !== date ? ' (останній доступний знімок)' : ''}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">
            Розмір сторінки:
            <select
              className="ml-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value))
                setPage(1)
              }}
            >
              {[20, 50, 100, 150].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 disabled:opacity-50"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page <= 1 || query.isLoading}
            >
              Попередня
            </button>
            <span className="text-slate-600">
              Сторінка {page} з {totalPages}
            </span>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1 text-sm text-slate-600 disabled:opacity-50"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || query.isLoading}
            >
              Наступна
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <RecommendationTable
          rows={sortedRows}
          isLoading={query.isLoading}
          error={query.error as Error | undefined}
        />
      </section>


    </main>
  )
}

function applyFilters(rows: RecommendationRow[], filters: Filters) {
  const search = filters.search.toLowerCase()
  return rows.filter((row) => {
    if (
      search &&
      !row.sku.toLowerCase().includes(search) &&
      !row.name.toLowerCase().includes(search) &&
      !row.reason.toLowerCase().includes(search)
    ) {
      return false
    }
    if (filters.category !== 'ALL' && row.category !== filters.category) {
      return false
    }
    if (filters.segment !== 'ALL' && row.segment !== filters.segment) {
      return false
    }
    if (filters.zone !== 'ALL' && row.zone !== filters.zone) {
      return false
    }
    if (filters.overstock === 'only' && !row.overstock) {
      return false
    }
    if (filters.overstock === 'none' && row.overstock) {
      return false
    }
    return true
  })
}

function applySorting(rows: RecommendationRow[], sortConfig: SortConfig) {
  const sorted = [...rows]
  sorted.sort((a, b) => {
    const field = sortConfig.field
    const direction = sortConfig.direction === 'asc' ? 1 : -1
    const av = (a[field] as number) ?? 0
    const bv = (b[field] as number) ?? 0
    if (av === bv) return 0
    return av > bv ? direction : -direction
  })
  return sorted
}

function RecommendationTable({
  rows,
  isLoading,
  error,
}: {
  rows: RecommendationRow[]
  isLoading?: boolean
  error?: Error
}) {
  return (
    <table className="min-w-full divide-y divide-slate-200">
      <thead className="bg-slate-50">
        <tr>
          {[
            'SKU',
            'Категорія',
            'Зона',
            'Target',
            'On hand',
            'Місячний попит',
            'Inbound',
            'Suggested',
            'Reason',
            'Overstock',
            'Показники',
          ].map((col) => (
            <th
              key={col}
              className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {isLoading && (
          <tr>
            <td colSpan={11} className="px-4 py-6 text-center text-slate-500">
              Завантаження...
            </td>
          </tr>
        )}
        {error && (
          <tr>
            <td colSpan={11} className="px-4 py-6 text-center text-red-600">
              {error.message}
            </td>
          </tr>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <tr>
            <td colSpan={11} className="px-4 py-6 text-center text-slate-500">
              Даних немає — спробуйте інший день або склад.
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <tr key={`${row.sku}-${row.category ?? 'none'}`}>
            <td className="px-4 py-4 text-sm text-slate-900">
              <div className="font-mono">{row.sku}</div>
              <div className="text-slate-500">{row.name}</div>
            </td>
            <td className="px-4 py-4 text-sm text-slate-700">{row.category ?? '—'}</td>
            <td className="px-4 py-4">
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  zoneClasses[row.zone] ?? 'bg-slate-100 text-slate-700'
                }`}
              >
                {row.zone.toUpperCase()}
              </span>
            </td>
            <td className="px-4 py-4">{row.target}</td>
            <td className="px-4 py-4">{row.onHand}</td>
            <td className="px-4 py-4">{row.monthlyDemand}</td>
            <td className="px-4 py-4">{row.inbound}</td>
            <td className="px-4 py-4 font-semibold text-indigo-700">{row.suggestedQty}</td>
            <td className="px-4 py-4 text-sm text-slate-500">{row.reason}</td>
            <td className="px-4 py-4 text-sm">
              {row.overstock ? (
                <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                  {row.overstock.message}
                </span>
              ) : (
                '—'
              )}
            </td>
            <td className="px-4 py-4 text-xs text-slate-500">
              <div>Segment: {row.segment}</div>
              <div>Avg DD: {row.avgDailyDemand} /дн</div>
              <div>Monthly demand: {row.monthlyDemand}</div>
              <div>Lead time: {row.leadTimeDays} дн</div>
              <div>DoS: {row.daysOfSupply ?? '—'} дн</div>
              <div>
                Penetration:{' '}
                {row.bufferPenetration !== null
                  ? `${Math.round(row.bufferPenetration * 100)}%`
                  : '—'}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function buildWarehouseInsight(resp: WarehouseRecommendationResponse) {
  const redCount = resp.data.filter((row) => row.zone === 'red').length
  const overstockCount = resp.data.filter((row) => row.overstock).length
  const suggestedTotal = resp.data.reduce((sum, row) => sum + row.suggestedQty, 0)
  if (redCount > 0) {
    return `⚠️ ${redCount} SKU у червоній зоні — поповніть буфер (рекомендуємо ${
      suggestedTotal > 0 ? `${Math.round(suggestedTotal)} шт` : 'мінімальне поповнення'
    }).`
  }
  if (overstockCount > 0) {
    return `📦 ${overstockCount} SKU з надлишком — перегляньте промо або зменшіть замовлення.`
  }
  if (suggestedTotal > 0) {
    return `📝 Заплануйте поставку ≈${Math.round(suggestedTotal)} шт для підтримки жовтої зони.`
  }
  return '✅ Буфер в зеленій зоні — додаткові дії не потрібні.'
}
