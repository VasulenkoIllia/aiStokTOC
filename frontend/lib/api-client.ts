'use client'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api'

type FetchOptions = RequestInit & {
  token?: string | null
  skipAuth?: boolean
}

type ApiError = {
  error?: string
  message?: string
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, skipAuth, headers, ...rest } = options
  const mergedHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    ...(headers ?? {}),
  }

  if (token && !skipAuth) {
    mergedHeaders.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: mergedHeaders,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : null

  if (!response.ok) {
    const errorBody = (payload as ApiError | null) ?? {}
    const errorMessage =
      errorBody.error || errorBody.message || response.statusText || 'Server error'
    throw new Error(errorMessage)
  }

  return (payload ?? {}) as T
}

export type LoginResponse = {
  token: string
  user: {
    id: string
    email: string
    org_id: string
    role: string
  }
}

export function loginRequest(email: string, password: string) {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify({ email, password }),
  })
}

export type RegisterPayload = {
  org_name: string
  email: string
  password: string
  name?: string
  warehouse_name?: string
}

export function registerRequest(payload: RegisterPayload) {
  return apiFetch<LoginResponse>('/auth/register', {
    method: 'POST',
    skipAuth: true,
    body: JSON.stringify(payload),
  })
}

export function fetchApiKey(token: string) {
  return apiFetch<{ api_key: string }>('/auth/api-key', { token })
}

export function rotateApiKey(token: string) {
  return apiFetch<{ api_key: string }>('/auth/api-key/rotate', {
    method: 'POST',
    token,
  })
}

export type WarehouseOption = {
  id: string
  name: string
  latestStockDate: string | null
}

export function fetchWarehouses(token: string) {
  return apiFetch<{ data: WarehouseOption[] }>('/warehouses', { token })
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

export type RecommendationsResponse = {
  org_id: string
  warehouse_id: string
  date: string
  effective_date: string | null
  page: number
  page_size: number
  total: number
  data: RecommendationRow[]
}

export function fetchRecommendations(
  token: string,
  params: { warehouseId: string; date?: string; page?: number; pageSize?: number },
) {
  const query = new URLSearchParams({
    warehouse_id: params.warehouseId,
    ...(params.date ? { date: params.date } : {}),
    ...(params.page ? { page: String(params.page) } : {}),
    ...(params.pageSize ? { page_size: String(params.pageSize) } : {}),
  })
  return apiFetch<RecommendationsResponse>(`/recommendations?${query.toString()}`, { token })
}

export function fetchBuffers(token: string, warehouseId: string, recalc = false) {
  const query = new URLSearchParams({
    warehouse_id: warehouseId,
    recalc: String(recalc),
  })
  return apiFetch<{ data: Array<any> }>(`/buffers?${query.toString()}`, { token })
}

export function fetchSkuKpi(
  token: string,
  sku: string,
  params: { warehouseId?: string; from?: string; to?: string },
) {
  const query = new URLSearchParams({
    ...(params.warehouseId ? { warehouse_id: params.warehouseId } : {}),
    ...(params.from ? { from: params.from } : {}),
    ...(params.to ? { to: params.to } : {}),
  })
  return apiFetch<{
    sku: string
    metrics: {
      dos: number | null
      turns: number
      median_days_to_sell?: number
      fefo_risk: boolean
      on_hand: number
      avg_daily_demand: number
    }
  }>(`/kpi/sku/${sku}?${query.toString()}`, { token })
}

export function ingestPayload(
  token: string,
  feed: 'catalog' | 'sales_report' | 'stock' | 'po_header' | 'po_lines',
  payload: unknown,
) {
  return apiFetch(`/ingest/${feed}`, {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  })
}

export function assistantQuery(token: string, question: string) {
  return apiFetch<{ answer: string }>(`/assistant/query`, {
    method: 'POST',
    token,
    body: JSON.stringify({ question }),
  })
}

export function assistantExplain(token: string, params: { sku: string; warehouse_id: string }) {
  const query = new URLSearchParams(params)
  return apiFetch<{ explanation: string }>(`/assistant/explain?${query.toString()}`, { token })
}
