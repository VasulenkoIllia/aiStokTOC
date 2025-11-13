import { Router } from 'express'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { subDays } from 'date-fns'
import { z } from 'zod'
import { openaiClient } from '../lib/openai'
import { env } from '../config/env'
import { buildExplainPayload } from '../modules/assistant/payload'
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
    return res.json({
      question,
      answer:
        summarizeContext(context) ??
        'Не вдалося отримати відповідь AI. Спробуйте пізніше або скористайтеся /assistant/explain.',
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
            'Ти — AI-асистент складу. Поясни українською коротко (до 3 речень), що відбувається з буфером, чи потрібне замовлення і чому.',
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
  if (!payload) return 'Дані відсутні.'
  const penetrationPct = Math.round(payload.buffer_penetration * 100)
  const zoneText =
    payload.zone === 'Red'
      ? 'буфер у червоній зоні — потрібне термінове поповнення.'
      : payload.zone === 'Yellow'
        ? 'буфер у жовтій зоні — плануйте замовлення.'
        : 'буфер у зеленій зоні — запас в межах норми.'

  let orderText = 'Додаткове замовлення не потрібне.'
  if (payload.order_raw > 0) {
    orderText = `Розрахунковий дефіцит ${Math.ceil(payload.order_raw)} шт, тож варто поповнити буфер.`
  }

  return `SKU ${payload.sku}: penetration ${penetrationPct}%, ${zoneText} ${orderText}`
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
  const parts: string[] = []
  if (context.top_skus?.length) {
    const topLine = context.top_skus
      .slice(0, 3)
      .map((sku) => `${sku.sku} (${sku.units} шт/ ${context.lookback_days}д)`)
      .join(', ')
    parts.push(`Топ продажів за ${context.lookback_days} днів: ${topLine}.`)
  }
  const warehousePieces = context.warehouses.map((wh) => {
    if (!wh.top_recommendations.length) {
      const best =
        wh.best_sellers?.length > 0
          ? ` Топ SKU: ${wh.best_sellers
              .slice(0, 2)
              .map((sku) => `${sku.sku} (${sku.units} шт)`)
              .join(', ')}.`
          : ''
      return `На складі ${wh.warehouse_name} (ID ${wh.warehouse_id}) буфер у нормі.${best}`
    }
    const top = wh.top_recommendations
      .map(
        (rec) =>
          `${rec.sku}: зона ${rec.zone}, target ${rec.target}, on_hand ${rec.onHand}, пропонуємо ${rec.suggestedQty}`,
      )
      .join('; ')
    const best =
      wh.best_sellers?.length > 0
        ? ` Топ продажів: ${wh.best_sellers
            .slice(0, 2)
            .map((sku) => `${sku.sku} (${sku.units} шт)`)
            .join(', ')}.`
        : ''
    return `Склад ${wh.warehouse_name} (ID ${wh.warehouse_id}): ${top}.${best}`
  })
  parts.push(...warehousePieces)
  return parts.join(' ')
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
    return summary ?? 'Дані тимчасово недоступні.'
  }

  const contextSnippet = buildContextSnippet(context)
  const systemPrompt = [
    'Ти — AI-асистент складу, який працює з ТОС-бізнес-логікою.',
    'Якщо для відповіді бракує фактів (продажі, залишки, буфери, PO) — ОБОВʼЯЗКОВО викликай відповідний інструмент.',
    'Памʼятай попередні запитання користувача: якщо згадують "цей товар" або "цей склад", використовуй останній згаданий у діалозі SKU/склад.',
    'Коли питають про продажі за період, топ складів чи переміщення, спершу викликай get_sales_summary або get_stock_by_warehouse / suggest_rebalance — не вигадуй дані самостійно.',
    'Інструменти: get_stock_by_warehouse (розподіл залишків), get_sales_summary (порівняння продажів), suggest_rebalance (надлишок/дефіцит між складами), а також базові get_top_skus, get_sales_by_day, get_stock_status, get_buffer_status, get_purchase_orders, get_recommendations_for_sku.',
    'Відповідай українською, чітко, з цифрами й висновками.',
  ].join(' ')

  const historyMessages: ChatCompletionMessageParam[] = []
  if (memoryKey) {
    const history = assistantMemory.get(memoryKey) ?? []
    history.slice(-MAX_MEMORY_ENTRIES).forEach((entry) => {
      historyMessages.push({ role: 'user', content: entry.user })
      historyMessages.push({ role: 'assistant', content: entry.assistant })
    })
  }

  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }]
  if (contextSnippet) {
    messages.push({
      role: 'system',
      content: `Оперативний контекст: ${contextSnippet}`,
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
    'Не вдалося отримати відповідь AI. Спробуйте інакше сформулювати питання або повторити пізніше.'
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
