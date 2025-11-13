import { Router } from 'express'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { subDays } from 'date-fns'
import { z } from 'zod'
import { openaiClient } from '../lib/openai'
import { env } from '../config/env'
import { buildExplainPayload } from '../modules/assistant/payload'
import {
  WEEKDAY_SEASONALITY_BASELINE_MIN_UNITS,
  WEEKDAY_SEASONALITY_MIN_WEEKS,
  WEEKDAY_SEASONALITY_THRESHOLD_PCT,
} from '../modules/assistant/constants'
import { getOrgIdFromRequest } from '../middleware/auth'
import { prisma } from '../db/client'
import { getRecommendations } from '../modules/recommendations/service'
import {
  executeAssistantTool,
  openAiToolDefinitions,
} from '../modules/assistant/tools'

const questionSchema = z.object({
  question: z.string().min(5),
})

const explainSchema = z.object({
  sku: z.string(),
  warehouse_id: z.string(),
  date: z.string().optional(),
})

type ConversationEntry = {
  user: string
  assistant: string
}

const assistantMemory = new Map<string, ConversationEntry[]>()
const MAX_MEMORY_ENTRIES = 4

export const assistantRouter = Router()

assistantRouter.post('/query', async (req, res) => {
  const body = questionSchema.safeParse(req.body)
  if (!body.success) {
    return res.status(400).json({ error: body.error.message })
  }

  const question = body.data.question.trim()

  const orgId = await getOrgIdFromRequest(req)
  const memoryKey = req.user?.userId ? `user:${req.user.userId}` : `org:${orgId}`
  const context = await buildAssistantContext(orgId)

  try {
    const answer = await runAssistantConversation({
      question,
      orgId,
      context,
      memoryKey,
    })
    return res.json({ question, answer })
  } catch (error) {
    req.log.error({ err: error }, 'AI query failed')
    const fallbackMessage =
      summarizeContext(context) ??
      '### Висновок\n- Не вдалося отримати відповідь AI. Спробуйте пізніше або скористайтеся /assistant/explain.'
    return res.json({
      question,
      answer: fallbackMessage,
    })
  }
})

assistantRouter.get('/explain', async (req, res) => {
  const params = explainSchema.safeParse(req.query)
  if (!params.success) {
    return res.status(400).json({ error: params.error.message })
  }

  try {
    const orgId = await getOrgIdFromRequest(req)
    const payload = await buildExplainPayload({
      orgId,
      warehouseId: params.data.warehouse_id,
      sku: params.data.sku,
      date: params.data.date,
    })

    if (!payload) {
      return res.status(404).json({ error: 'Не вдалося знайти дані для пояснення.' })
    }

    const explanation = await generateExplanation(payload)

    return res.json({
      ...payload,
      explanation,
    })
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

async function generateExplanation(payload: Awaited<ReturnType<typeof buildExplainPayload>>) {
  if (!payload) return 'Дані відсутні.'

  if (!openaiClient) {
    return buildHeuristicExplanation(payload)
  }

  const template = `Поясни рекомендацію ТОС для SKU ${payload.sku}.
Дані: ${JSON.stringify(payload)}`

  try {
    const completion = await openaiClient.responses.create({
      model: env.OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content:
            'Ти — аналітичний асистент складу. Поясни українською в Markdown-форматі: блок "### Висновок" (1–2 речення) та блок "### Деталі" зі списком ключових цифр і рекомендацією щодо замовлення.',
        },
        { role: 'user', content: template },
      ],
    })

    return (
      completion.output?.[0]?.content?.[0]?.text ??
      completion.output_text ??
      buildHeuristicExplanation(payload)
    )
  } catch (error) {
    return buildHeuristicExplanation(payload)
  }
}

function buildHeuristicExplanation(
  payload: Awaited<ReturnType<typeof buildExplainPayload>>,
): string {
  if (!payload) return '### Висновок\n- Дані відсутні.'
  const penetrationPct = Math.round(payload.buffer_penetration * 100)
  const zoneText =
    payload.zone === 'Red'
      ? 'Буфер у червоній зоні — потрібне термінове поповнення.'
      : payload.zone === 'Yellow'
        ? 'Буфер у жовтій зоні — плануйте замовлення найближчим часом.'
        : 'Буфер у зеленій зоні — запас у межах норми.'

  const orderText =
    payload.order_raw > 0
      ? `Розрахунковий дефіцит ≈ **${Math.ceil(payload.order_raw)} шт**, тож варто поповнити буфер.`
      : 'Додаткове замовлення зараз не потрібне.'

  return [
    '### Висновок',
    `- ${zoneText}`,
    '',
    '### Деталі',
    `- SKU: **${payload.sku}**`,
    `- Penetration: **${penetrationPct}%**`,
    `- Target: **${payload.target_qty} шт**, on hand: **${payload.on_hand} шт**`,
    `- ${orderText}`,
  ].join('\n')
}

type AssistantContext = Awaited<ReturnType<typeof buildAssistantContext>>
const TOP_SELLER_LOOKBACK_DAYS = 60

async function buildAssistantContext(orgId: string) {
  const warehouses = await prisma.warehouses.findMany({
    where: { org_id: orgId },
    take: 3,
    orderBy: { created_at: 'asc' },
  })

  const date = new Date().toISOString().slice(0, 10)
  const [topSkus, warehouseTopMap] = await Promise.all([
    getTopSkus(orgId, TOP_SELLER_LOOKBACK_DAYS),
    getWarehouseTopSkus(orgId, warehouses.map((wh) => wh.id), TOP_SELLER_LOOKBACK_DAYS),
  ])

  const contexts = []
  for (const wh of warehouses) {
    const { data: recs } = await getRecommendations({
      orgId,
      warehouseId: wh.id,
      date,
      autoRecalc: false,
      pageSize: 5,
    })
    contexts.push({
      warehouse_id: wh.id,
      warehouse_name: wh.name,
      best_sellers: warehouseTopMap.get(wh.id) ?? [],
      top_recommendations: recs.slice(0, 5),
    })
  }

  return {
    date,
    lookback_days: TOP_SELLER_LOOKBACK_DAYS,
    top_skus: topSkus,
    warehouses: contexts,
  }
}

function summarizeContext(context: AssistantContext | null) {
  if (!context || !context.warehouses.length) return null

  const lines: string[] = []

  if (context.top_skus?.length) {
    lines.push(`### Топ продажів за ${context.lookback_days} днів`)
    lines.push('| SKU | Одиниць |')
    lines.push('| --- | ---: |')
    context.top_skus.slice(0, 5).forEach((sku) => {
      lines.push(`| ${sku.sku} | ${sku.units} |`)
    })
  }

  lines.push('### Статус складів')
  context.warehouses.forEach((wh) => {
    lines.push(`#### ${wh.warehouse_name} (${wh.warehouse_id})`)

    if (wh.top_recommendations.length) {
      lines.push('| SKU | Зона | Target | On hand | Пропозиція |')
      lines.push('| --- | --- | ---: | ---: | ---: |')
      wh.top_recommendations.forEach((rec) => {
        lines.push(
          `| ${rec.sku} | ${rec.zone} | ${rec.target} | ${rec.onHand} | ${rec.suggestedQty} |`,
        )
      })
    } else {
      lines.push('- Буфери в нормі, рекомендацій немає.')
    }

    if (wh.best_sellers?.length) {
      const bestLine = wh.best_sellers
        .slice(0, 3)
        .map((sku) => `${sku.sku} (${sku.units} шт)`)
        .join(', ')
      lines.push(`- **Топ продажів:** ${bestLine}`)
    }
  })

  return lines.join('\n\n').trim()
}

async function getTopSkus(orgId: string, lookbackDays: number, limit = 10) {
  const since = subDays(new Date(), lookbackDays)
  const rows = await prisma.sales_daily.groupBy({
    by: ['sku'],
    where: {
      org_id: orgId,
      date: {
        gte: since,
      },
    },
    _sum: {
      units: true,
      revenue: true,
    },
    orderBy: {
      _sum: {
        units: 'desc',
      },
    },
    take: limit,
  })

  return rows.map((row) => ({
    sku: row.sku,
    units: Number(row._sum.units ?? 0),
    revenue: Number(row._sum.revenue ?? 0),
  }))
}

async function getWarehouseTopSkus(
  orgId: string,
  warehouseIds: string[],
  lookbackDays: number,
  perWarehouse = 3,
) {
  const map = new Map<string, Array<{ sku: string; units: number }>>()
  if (!warehouseIds.length) return map
  const since = subDays(new Date(), lookbackDays)
  const rows = await prisma.sales_daily.groupBy({
    by: ['warehouse_id', 'sku'],
    where: {
      org_id: orgId,
      warehouse_id: { in: warehouseIds },
      date: { gte: since },
    },
    _sum: {
      units: true,
    },
  })

  for (const row of rows) {
    if (!row.warehouse_id) continue
    const list = map.get(row.warehouse_id) ?? []
    list.push({
      sku: row.sku,
      units: Number(row._sum.units ?? 0),
    })
    map.set(row.warehouse_id, list)
  }

  for (const [key, list] of map.entries()) {
    list.sort((a, b) => b.units - a.units)
    map.set(key, list.slice(0, perWarehouse))
  }

  return map
}

async function runAssistantConversation({
  question,
  orgId,
  context,
  memoryKey,
}: {
  question: string
  orgId: string
  context: AssistantContext
  memoryKey?: string
}) {
  if (!openaiClient) {
    const summary = summarizeContext(context)
    return summary ?? '### Висновок\n- Дані тимчасово недоступні.'
  }

  const contextSnippet = buildContextSnippet(context)
  const systemPrompt = [
    'Ти — аналітичний асистент для складу й продажів, який працює з ТОС-метриками.',
    'Відповідай українською, лаконічно та по суті.',
    'Завжди використовуй Markdown: заголовки рівня ###, марковані списки (-), таблиці (GFM), **жирне** для ключових чисел, code blocks ``` для SQL/JSON.',
    'Для запитів про SKU/склади дотримуйся структури: ### Висновок (1–3 речення) → Markdown-таблиця з цифрами → ### Рекомендації (2–5 булетів).',
    'Якщо бракує даних (продажі, залишки, буфери, PO), обовʼязково викликай відповідний інструмент: get_sales_summary, get_sales_windows, get_sku_sales_timeseries, get_weekday_seasonality, get_stock_by_warehouse, suggest_rebalance, get_top_skus, get_sales_by_day, get_stock_status, get_buffer_status, get_purchase_orders, get_recommendations_for_sku.',
    'За замовчуванням збирай базовий контекст продажів за 10/30/60/90 днів через get_sales_windows; якщо користувач задає конкретний період або кількість днів, застосовуй саме ці межі у всіх викликах (get_sales_summary, get_sku_sales_timeseries, get_weekday_seasonality тощо).',
    'Коли запитують "на якому складі"/"де краще продається" конкретний SKU або згадують UUID/SKU-XXX, СПОЧАТКУ викликай get_sales_summary з параметрами (sku=<згаданий SKU>, group_by="warehouse", metric="units") і роби висновки лише на основі повернених цифр.',
    'Памʼятай попередній контекст: якщо користувач каже "цей SKU/цей склад", використовуй останні згадані значення.',
    'Завжди зазначай період/дату, за який наведені цифри (from–to або конкретна дата знімка), навіть якщо користувач не назвав проміжок.',
    'У відповідях завжди показуй пару «код → назва»: наприклад, `SKU-001 (Амортизатор)` і `WH-KYIV (Київський хаб)`, використовуючи sku_name та warehouse_name з інструментів.',
  ].join(' ')

  const historyMessages: ChatCompletionMessageParam[] = []
  if (memoryKey) {
    const history = assistantMemory.get(memoryKey) ?? []
    history.slice(-MAX_MEMORY_ENTRIES).forEach((entry) => {
      historyMessages.push({ role: 'user', content: entry.user })
      historyMessages.push({ role: 'assistant', content: entry.assistant })
    })
  }

  const detectedSku = extractSkuFromQuestion(question)
  const timeframe = extractTimeframe(question)
  const wantsBestDay = detectedSku ? needsBestDayInsight(question) : false
  const wantsWeekdaySeasonality = needsWeekdaySeasonality(question)
  const wantsPeriodicSeasonality = needsPeriodicSeasonality(question)
  const prefetchedTools: Array<{ name: string; data: any }> = []

  const prefetchTool = async (toolName: string, args: Record<string, unknown>) => {
    try {
      const result = await executeAssistantTool(toolName, { orgId }, JSON.stringify(args))
      prefetchedTools.push({ name: toolName, data: result })
    } catch (error) {
      console.error(`Failed to prefetch ${toolName}`, error)
    }
  }

  if (wantsWeekdaySeasonality) {
    const seasonalityArgs = parseJsonArgs<Record<string, unknown>>(
      buildSeasonalityParams(timeframe, detectedSku),
    )
    await prefetchTool('get_weekday_seasonality', seasonalityArgs)
  }
  if (detectedSku && wantsBestDay) {
    await prefetchTool('get_sku_sales_timeseries', { sku: detectedSku, limit: 120 })
  }
  if (wantsPeriodicSeasonality) {
    const granularities = extractGranularities(question)
    const periodicArgs = parseJsonArgs<Record<string, unknown>>(
      buildPeriodicSeasonalityParams(timeframe, detectedSku, granularities),
    )
    await prefetchTool('get_periodic_seasonality', periodicArgs)
  }
  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }]
  if (contextSnippet) {
    messages.push({
      role: 'system',
      content: `Оперативний контекст: ${contextSnippet}`,
    })
  }
  prefetchedTools.forEach(({ name, data }) => {
    messages.push({
      role: 'system',
      content: `Попередньо зібрані дані ${name}: ${summarizeToolData(
        data,
      )}. Використай їх у відповіді (за потреби можеш викликати тул ще раз для уточнення).`,
    })
  })
  if (detectedSku) {
    messages.push({
      role: 'system',
      content: `У запитанні згадано SKU ${detectedSku}. Якщо потрібно показати найкращі склади або продажі, виклич найперше get_sales_summary зі значенням {"sku":"${detectedSku}","group_by":"warehouse","metric":"units","limit":20} і відповідай, спираючись на ці дані.`,
    })
  }
  applyTimeframeInstructions(messages, timeframe, detectedSku)
  if (detectedSku && wantsBestDay) {
    messages.push({
      role: 'system',
      content: `Користувач хоче знати, в які дні SKU ${detectedSku} продавався найкраще. Виклич get_sku_sales_timeseries щонайменше на 120 днів ({"sku":"${detectedSku}","limit":120}) та визнач пікові дні за units. Відповідь має містити дату/значення з цієї серії.`,
    })
  }
  if (wantsWeekdaySeasonality) {
    const seasonalityParams = buildSeasonalityParams(timeframe, detectedSku)
    messages.push({
      role: 'system',
      content: `Користувач питає про тижневу сезонність продажів. Обовʼязково виклич get_weekday_seasonality з параметрами ${seasonalityParams} (досить 60 днів, якщо період не заданий) і у відповіді покажи SKU, склад, день тижня, середній продаж цього дня та відрив від середнього. Якщо користувач не вказує власні пороги, використовуй threshold_pct=${WEEKDAY_SEASONALITY_THRESHOLD_PCT}, min_weeks=${WEEKDAY_SEASONALITY_MIN_WEEKS} та baseline_min_units=${WEEKDAY_SEASONALITY_BASELINE_MIN_UNITS}. У фінальній відповіді явно зазначай, з яким порогом чутливості (%), мінімальною кількістю тижнів та базовим середнім (baseline_min_units) виконувався аналіз (підтягуй threshold_pct, min_weeks та baseline_min_units із відповіді інструмента).`,
    })
  }
  if (wantsPeriodicSeasonality) {
    const granularities = extractGranularities(question)
    const periodicParams = buildPeriodicSeasonalityParams(timeframe, detectedSku, granularities)
    messages.push({
      role: 'system',
      content: `Користувач цікавиться сезонністю за місяцями/днями місяця/роком. Виклич get_periodic_seasonality з параметрами ${periodicParams} і поясни, які періоди мають стабільно вищі продажі.`,
    })
  }
  messages.push(...historyMessages)
  messages.push({ role: 'user', content: question })

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const completion = await openaiClient.chat.completions.create({
      model: env.OPENAI_MODEL,
      temperature: 0.2,
      messages,
      tools: openAiToolDefinitions,
      tool_choice: 'auto',
    })
    const message = completion.choices[0]?.message
    if (!message) break
    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls,
      })
      for (const toolCall of message.tool_calls) {
        const result = await executeAssistantTool(
          toolCall.function.name,
          { orgId },
          toolCall.function.arguments,
        )
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      }
      continue
    }
    const content = message.content?.trim()
    if (content) {
      if (memoryKey) {
        const history = assistantMemory.get(memoryKey) ?? []
        history.push({ user: question, assistant: content })
        const trimmed = history.slice(-MAX_MEMORY_ENTRIES)
        assistantMemory.set(memoryKey, trimmed)
      }
      return content
    }
  }

  return (
    summarizeContext(context) ??
    '### Висновок\n- Не вдалося отримати відповідь AI. Спробуйте інакше сформулювати питання або повторіть пізніше.'
  )
}

function buildContextSnippet(context: AssistantContext | null) {
  if (!context) return ''
  const parts: string[] = []
  if (context.top_skus?.length) {
    const top = context.top_skus
      .slice(0, 5)
      .map((item) => `${item.sku}:${item.units}`)
      .join(', ')
    parts.push(`топ SKU орг: ${top}`)
  }
  context.warehouses?.forEach((wh) => {
    if (!wh.top_recommendations.length) return
    parts.push(
      `${wh.warehouse_id} -> ${wh.top_recommendations
        .slice(0, 2)
        .map((rec) => `${rec.sku}/${rec.zone}`)
        .join(', ')}`,
    )
  })
  return parts.join(' | ')
}

const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const SKU_CODE_REGEX = /\bSKU[-_][A-Za-z0-9-]+\b/i
const DAY_KEYWORDS = ['день', 'дні', 'деньки', 'day', 'date', 'доба']
const SALES_KEYWORDS = ['продаж', 'sales', 'продали', 'продажів']
const DATE_REGEX = /\b\d{4}-\d{2}-\d{2}\b/g
const PARTIAL_DATE_REGEX = /\b(\d{1,2})[.\-/ ](\d{1,2})\b/g
const RELATIVE_MULTI_REGEX =
  /(останні|за останні|попередні|last)\s+((?:\d+[\s,\/-]*)+)\s*(?:дн|дні|днів|days)?/i
const RELATIVE_SINGLE_REGEX =
  /(останні|за останні|попередні|last)\s+(\d+)\s*(?:дн|дні|днів|days)?/i
const GENERIC_SINGLE_REGEX = /(?:за|протягом)\s+(\d+)\s*(?:дн|дні|днів|days)/i
const DEFAULT_WINDOWS = [10, 30, 60, 90]
const SEASONAL_KEYWORDS = ['сезонн', 'патерн', 'pattern', 'цикліч', 'повтор', 'стабільн']
const WEEK_KEYWORDS = ['тиж', 'щотиж', 'week', 'weekday', 'день тижня']
const MONTH_KEYWORDS = ['місяц', 'щомісяц', 'month']
const YEAR_KEYWORDS = ['рік', 'щоріч', 'річн', 'year', 'season']
const DAY_OF_MONTH_KEYWORDS = ['день місяц', 'day of month']
type TimeframeInfo =
  | { kind: 'absolute'; from: string; to: string }
  | { kind: 'relative_single'; days: number }
  | { kind: 'relative_multi'; windows: number[] }
  | { kind: 'none' }

function extractSkuFromQuestion(question: string) {
  if (!question) return null
  const uuidMatch = question.match(UUID_REGEX)
  if (uuidMatch) {
    return uuidMatch[0]
  }
  const skuMatch = question.match(SKU_CODE_REGEX)
  if (skuMatch) {
    return skuMatch[0]
  }
  return null
}

function needsBestDayInsight(question: string) {
  if (!question) return false
  const lower = question.toLowerCase()
  const mentionsDay = DAY_KEYWORDS.some((word) => lower.includes(word))
  const mentionsSales = SALES_KEYWORDS.some((word) => lower.includes(word))
  const mentionsBest =
    lower.includes('найкращ') ||
    lower.includes('найбіль') ||
    lower.includes('пік') ||
    lower.includes('кращий') ||
    lower.includes('який день') ||
    lower.includes('в який день')
  return mentionsDay && mentionsSales && mentionsBest
}

function needsWeekdaySeasonality(question: string) {
  if (!question) return false
  const lower = question.toLowerCase()
  const mentionsSeason = SEASONAL_KEYWORDS.some((word) => lower.includes(word))
  const mentionsWeek = WEEK_KEYWORDS.some((word) => lower.includes(word))
  const mentionsSales = SALES_KEYWORDS.some((word) => lower.includes(word))
  return (mentionsSeason || mentionsWeek) && mentionsSales
}

function needsPeriodicSeasonality(question: string) {
  if (!question) return false
  const lower = question.toLowerCase()
  const mentionsMonth = MONTH_KEYWORDS.some((word) => lower.includes(word))
  const mentionsYear = YEAR_KEYWORDS.some((word) => lower.includes(word))
  const mentionsDayOfMonth = DAY_OF_MONTH_KEYWORDS.some((word) => lower.includes(word))
  const mentionsSeason = SEASONAL_KEYWORDS.some((word) => lower.includes(word))
  const mentionsSales = SALES_KEYWORDS.some((word) => lower.includes(word))
  return (mentionsMonth || mentionsYear || mentionsDayOfMonth || mentionsSeason) && mentionsSales
}

function applyTimeframeInstructions(
  messages: ChatCompletionMessageParam[],
  timeframe: TimeframeInfo,
  sku?: string | null,
) {
  const skuFragment = sku ? `, "sku":"${sku}"` : ''
  if (timeframe.kind === 'absolute') {
    const params = `{"from":"${timeframe.from}","to":"${timeframe.to}"${skuFragment}}`
    messages.push({
      role: 'system',
      content: `Користувач задав період ${timeframe.from} – ${timeframe.to}. Для будь-яких числових відповідей викликай get_sales_summary (та, якщо потрібен тренд, get_sku_sales_timeseries) з параметрами ${params} і чітко зазначай, що дані саме за цей період.`,
    })
    return
  }
  if (timeframe.kind === 'relative_single') {
    const params = `{"days":${timeframe.days}${skuFragment}}`
    messages.push({
      role: 'system',
      content: `Користувач просить дані за останні ${timeframe.days} днів. Використовуй get_sales_summary (та за потреби get_sku_sales_timeseries) з параметрами ${params} і повідомляй, що цифри охоплюють цей проміжок.`,
    })
    return
  }
  if (timeframe.kind === 'relative_multi') {
    const windows = JSON.stringify(timeframe.windows)
    const params = `{"windows":${windows}${skuFragment}}`
    messages.push({
      role: 'system',
      content: `Користувач вказав кілька діапазонів (${timeframe.windows.join(
        ', ',
      )} днів). Обовʼязково виклич get_sales_windows з параметрами ${params} і включи ці періоди у відповідь.`,
    })
    return
  }
  const params = `{"windows":${JSON.stringify(DEFAULT_WINDOWS)}${skuFragment}}`
  messages.push({
    role: 'system',
    content: `Дати не вказані. Для базового контексту спочатку отримай get_sales_windows з параметрами ${params} (10/30/60/90 днів) і включи результати перед іншими метриками.`,
  })
}

function buildSeasonalityParams(timeframe: TimeframeInfo, sku?: string | null) {
  const params: Record<string, string | number> = {
    threshold_pct: WEEKDAY_SEASONALITY_THRESHOLD_PCT,
    min_weeks: WEEKDAY_SEASONALITY_MIN_WEEKS,
    baseline_min_units: WEEKDAY_SEASONALITY_BASELINE_MIN_UNITS,
  }
  if (sku) {
    params.sku = sku
  }
  if (timeframe.kind === 'absolute') {
    params.from = timeframe.from
    params.to = timeframe.to
    return JSON.stringify(params)
  }
  if (timeframe.kind === 'relative_single') {
    params.lookback_days = timeframe.days
    return JSON.stringify(params)
  }
  if (timeframe.kind === 'relative_multi') {
    const lookback =
      timeframe.windows.length > 0 ? Math.max(...timeframe.windows) : 60
    params.lookback_days = lookback
    return JSON.stringify(params)
  }
  params.lookback_days = 60
  return JSON.stringify(params)
}

function buildPeriodicSeasonalityParams(
  timeframe: TimeframeInfo,
  sku: string | null | undefined,
  granularities: string[],
) {
  const skuFragment = sku ? `,"sku":"${sku}"` : ''
  const granFragment = granularities.length
    ? `,"granularities":[${granularities.map((g) => `"${g}"`).join(',')}]`
    : ''
  if (timeframe.kind === 'absolute') {
    return `{"from":"${timeframe.from}","to":"${timeframe.to}"${skuFragment}${granFragment}}`
  }
  if (timeframe.kind === 'relative_single') {
    return `{"lookback_days":${timeframe.days}${skuFragment}${granFragment}}`
  }
  if (timeframe.kind === 'relative_multi') {
    const lookback = Math.max(...timeframe.windows)
    return `{"lookback_days":${lookback}${skuFragment}${granFragment}}`
  }
  return `{"lookback_days":180${skuFragment}${granFragment}}`
}

function extractTimeframe(question: string): TimeframeInfo {
  if (!question) return { kind: 'none' }
  const dateMatches = Array.from(question.matchAll(DATE_REGEX)).map((match) => match[0])
  if (dateMatches.length >= 2) {
    const sorted = [...dateMatches].sort()
    return { kind: 'absolute', from: sorted[0], to: sorted[sorted.length - 1] }
  }
  if (dateMatches.length === 1) {
    return { kind: 'absolute', from: dateMatches[0], to: dateMatches[0] }
  }
  const partialDates = extractPartialDates(question)
  if (partialDates.length >= 2) {
    return { kind: 'absolute', from: partialDates[0], to: partialDates[1] }
  }
  if (partialDates.length === 1) {
    return { kind: 'absolute', from: partialDates[0], to: partialDates[0] }
  }
  const multiMatch = question.match(RELATIVE_MULTI_REGEX)
  if (multiMatch) {
    const numbers = parseNumberList(multiMatch[2])
    if (numbers.length > 1) {
      return { kind: 'relative_multi', windows: numbers }
    }
    if (numbers.length === 1) {
      return { kind: 'relative_single', days: numbers[0] }
    }
  }
  const singleRelative = question.match(RELATIVE_SINGLE_REGEX)
  if (singleRelative) {
    const days = Math.min(Number(singleRelative[2]), 365)
    if (Number.isFinite(days) && days > 0) {
      return { kind: 'relative_single', days }
    }
  }
  const genericMatch = question.match(GENERIC_SINGLE_REGEX)
  if (genericMatch) {
    const days = Math.min(Number(genericMatch[1]), 365)
    if (Number.isFinite(days) && days > 0) {
      return { kind: 'relative_single', days }
    }
  }
  return { kind: 'none' }
}

function parseNumberList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,\/-]+/)
        .map((part) => Number(part.trim()))
        .filter((num) => Number.isFinite(num) && num > 0 && num <= 365),
    ),
  ).sort((a, b) => a - b)
}

function extractPartialDates(text: string) {
  const matches: string[] = []
  for (const match of text.matchAll(PARTIAL_DATE_REGEX)) {
    const iso = buildDateFromPartial(match[1], match[2])
    if (iso) {
      matches.push(iso)
    }
  }
  return matches
}

function buildDateFromPartial(dayInput: string, monthInput: string) {
  const day = Number(dayInput)
  const month = Number(monthInput)
  if (!Number.isFinite(day) || !Number.isFinite(month) || day < 1 || day > 31 || month < 1 || month > 12) {
    return null
  }
  const year = inferYearForMonth(month)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString().slice(0, 10)
}

function inferYearForMonth(month: number) {
  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  // Якщо місяць значно попереду поточного (наприклад, ми в березні, а користувач згадує листопад),
  // вважаємо, що йдеться про попередній рік.
  return month > currentMonth + 1 ? currentYear - 1 : currentYear
}

function extractGranularities(question: string) {
  if (!question) return []
  const lower = question.toLowerCase()
  const list: string[] = []
  if (WEEK_KEYWORDS.some((word) => lower.includes(word))) {
    list.push('weekday')
  }
  if (DAY_OF_MONTH_KEYWORDS.some((word) => lower.includes(word))) {
    list.push('day_of_month')
  }
  if (MONTH_KEYWORDS.some((word) => lower.includes(word)) || YEAR_KEYWORDS.some((word) => lower.includes(word))) {
    list.push('month')
  }
  return Array.from(new Set(list))
}

function parseJsonArgs<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.error('Failed to parse JSON args', error)
    return {} as T
  }
}

function summarizeToolData(data: any) {
  const json = JSON.stringify(data)
  if (json.length <= 4000) return json
  return `${json.slice(0, 4000)}… (truncated)`
}
