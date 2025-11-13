import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { formatISO, subDays } from 'date-fns'
import iconv from 'iconv-lite'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/db/client'
import { rebuildSalesDaily } from '../src/modules/sales/daily-builder'
import { recalcBuffers } from '../src/modules/calculations/buffers'

type FieldDef = {
  name: string
  type: string
  length: number
  decimal: number
}

type ParsedRow = {
  date: Date
  warehouseName: string
  sku: string
  productName: string
  soldQty: number
  stockQty: number
}

const DEFAULT_BATCH = 1000
const SALES_BATCH_SIZE = 800
const STOCK_BATCH_SIZE = 800

async function main() {
  const args = parseArgs()
  if (!fs.existsSync(args.file)) {
    throw new Error(`File not found: ${args.file}`)
  }

  console.log(`📁 Reading DBF: ${args.file}`)
  const fd = fs.openSync(args.file, 'r')
  const headerBuf = Buffer.alloc(32)
  fs.readSync(fd, headerBuf, 0, 32, 0)
  const recordCount = headerBuf.readUInt32LE(4)
  const headerLen = headerBuf.readUInt16LE(8)
  const recordLen = headerBuf.readUInt16LE(10)
  const fields = readFields(fd, headerLen)

  console.log(
    `Records reported: ${recordCount}, header: ${headerLen}, record length: ${recordLen}`,
  )

  const orgId = args.org
  const limit = args.limit ? Math.min(args.limit, recordCount) : recordCount
  console.log(
    `Org: ${orgId}. Processing ${limit.toLocaleString()} records (batch ${DEFAULT_BATCH}).`,
  )

  const warehouseCache = await loadWarehouses(orgId)
  const catalogCache = await loadCatalog(orgId)

  let processed = 0
  let position = headerLen
  const activeWarehouses = new Set<string>()
  let minDate: Date | null = null
  let maxDate: Date | null = null

  let salesBatch: Parameters<typeof prisma.sales_events.createMany>[0]['data'] = []
  let stockBatch: Parameters<typeof prisma.stock_snapshots.createMany>[0]['data'] = []

  const buffer = Buffer.alloc(recordLen * DEFAULT_BATCH)

  while (processed < limit) {
    const remaining = Math.min(DEFAULT_BATCH, limit - processed)
    const chunkSize = remaining * recordLen
    const bytesRead = fs.readSync(fd, buffer, 0, chunkSize, position)
    if (bytesRead !== chunkSize) {
      console.warn('⚠️ Unexpected EOF, stopping early.')
      break
    }
    position += chunkSize

    for (let i = 0; i < remaining; i++) {
      const start = i * recordLen
      const recBuf = buffer.subarray(start, start + recordLen)
      if (recBuf[0] === 0x2a) continue // deleted
      const parsed = parseRecord(recBuf, fields)
      if (!parsed) continue
      await ensureWarehouse(parsed.warehouseName, orgId, warehouseCache)
      await ensureCatalog(parsed.sku, parsed.productName, orgId, catalogCache)

      const warehouseId = warehouseCache.get(parsed.warehouseName)!
      activeWarehouses.add(warehouseId)

      salesBatch.push({
        org_id: orgId,
        order_id: buildOrderId(parsed, warehouseId),
        line_id: '1',
        order_datetime: parsed.date,
        sku: parsed.sku,
        qty: new Prisma.Decimal(parsed.soldQty ?? 0),
        net_amount: new Prisma.Decimal(0),
        unit_price: null,
        warehouse_id: warehouseId,
        channel: '1C',
        status: parsed.soldQty > 0 ? 'completed' : 'none',
      })

      stockBatch.push({
        org_id: orgId,
        date: parsed.date,
        sku: parsed.sku,
        warehouse_id: warehouseId,
        qty_on_hand: new Prisma.Decimal(parsed.stockQty ?? 0),
        batch_id: '_dbf',
      })

      if (!minDate || parsed.date < minDate) minDate = parsed.date
      if (!maxDate || parsed.date > maxDate) maxDate = parsed.date

      if (salesBatch.length >= SALES_BATCH_SIZE) {
        await flushSales(salesBatch)
        salesBatch = []
      }
      if (stockBatch.length >= STOCK_BATCH_SIZE) {
        await flushStock(stockBatch)
        stockBatch = []
      }
    }

    processed += remaining
    if (processed % 50000 === 0) {
      console.log(`… processed ${processed.toLocaleString()} rows`)
    }
  }

  fs.closeSync(fd)
  await flushSales(salesBatch)
  await flushStock(stockBatch)

  if (minDate && maxDate) {
    console.log(
      `📊 Rebuilding sales_daily (${formatISO(minDate, {
        representation: 'date',
      })} → ${formatISO(maxDate, { representation: 'date' })})`,
    )
    await rebuildSalesDaily({
      orgId,
      from: formatISO(subDays(minDate, 1), { representation: 'date' }),
      to: formatISO(maxDate, { representation: 'date' }),
    })

    console.log(`🔁 Recalculating buffers for ${activeWarehouses.size} warehouses…`)
    for (const warehouseId of activeWarehouses) {
      await recalcBuffers({ orgId, warehouseId })
    }
  }

  console.log(`✅ Imported ${processed.toLocaleString()} records.`)
  await prisma.$disconnect()
}

function parseArgs() {
  const defaults = {
    file: 'ОборотыTEST.dbf',
    org: 'demo-org',
    limit: undefined as number | undefined,
  }
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--file' && args[i + 1]) {
      defaults.file = args[i + 1]
      i += 1
    } else if (arg.startsWith('--file=')) {
      defaults.file = arg.slice(7)
    } else if (arg === '--org' && args[i + 1]) {
      defaults.org = args[i + 1]
      i += 1
    } else if (arg.startsWith('--org=')) {
      defaults.org = arg.slice(6)
    } else if (arg === '--limit' && args[i + 1]) {
      defaults.limit = Number(args[i + 1])
      i += 1
    } else if (arg.startsWith('--limit=')) {
      defaults.limit = Number(arg.slice(8))
    }
  }
  return defaults
}

function readFields(fd: number, headerLen: number): FieldDef[] {
  const fields: FieldDef[] = []
  const headerBuf = Buffer.alloc(headerLen)
  fs.readSync(fd, headerBuf, 0, headerLen, 0)
  let offset = 32
  while (offset < headerLen) {
    const fieldBuf = headerBuf.subarray(offset, offset + 32)
    if (fieldBuf[0] === 0x0d) break
    const zeroIndex = fieldBuf.indexOf(0)
    const name = fieldBuf
      .subarray(0, zeroIndex >= 0 ? zeroIndex : 11)
      .toString('ascii')
      .trim()
    const type = String.fromCharCode(fieldBuf[11])
    const length = fieldBuf[16]
    const decimal = fieldBuf[17]
    fields.push({ name, type, length, decimal })
    offset += 32
  }
  return fields
}

function parseRecord(buffer: Buffer, fields: FieldDef[]): ParsedRow | null {
  let offset = 1
  const raw: Record<string, string | number | null> = {}
  for (const field of fields) {
    const slice = buffer.subarray(offset, offset + field.length)
    offset += field.length
    let value: string | number | null = null
    if (field.type === 'C') {
      value = iconv.decode(slice, 'win1251').trim()
    } else if (field.type === 'D') {
      const txt = slice.toString('ascii').trim()
      value = txt ? `${txt.slice(0, 4)}-${txt.slice(4, 6)}-${txt.slice(6, 8)}` : null
    } else if (field.type === 'N' || field.type === 'F') {
      const txt = slice.toString('ascii').trim()
      value = txt ? Number(txt) : 0
    } else {
      value = slice.toString('ascii').trim()
    }
    raw[field.name] = value
  }

  const dateStr = raw.DATE as string | null
  const sku = (raw.ID as string | null)?.trim()
  const warehouseName = (raw.SKLAD as string | null)?.trim()
  const productName = (raw.TOVAR as string | null)?.trim()
  if (!dateStr || !sku || !warehouseName || !productName) {
    return null
  }

  const date = new Date(`${dateStr}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null

  return {
    date,
    warehouseName,
    sku,
    productName,
    soldQty: typeof raw.PRODANO === 'number' ? raw.PRODANO : 0,
    stockQty: typeof raw.OSTATOK === 'number' ? raw.OSTATOK : 0,
  }
}

async function loadWarehouses(orgId: string) {
  const cache = new Map<string, string>()
  const rows = await prisma.warehouses.findMany({
    where: { org_id: orgId },
    select: { id: true, name: true },
  })
  rows.forEach((row) => cache.set(row.name, row.id))
  return cache
}

async function loadCatalog(orgId: string) {
  const set = new Set<string>()
  const rows = await prisma.catalog.findMany({
    where: { org_id: orgId },
    select: { sku: true },
  })
  rows.forEach((row) => set.add(row.sku))
  return set
}

async function ensureWarehouse(
  name: string,
  orgId: string,
  cache: Map<string, string>,
) {
  if (cache.has(name)) return cache.get(name)!
  const id = buildWarehouseId(name)
  await prisma.warehouses.upsert({
    where: { id },
    update: { name },
    create: {
      id,
      org_id: orgId,
      name,
      timezone: 'Europe/Kyiv',
    },
  })
  cache.set(name, id)
  return id
}

async function ensureCatalog(
  sku: string,
  productName: string,
  orgId: string,
  cache: Set<string>,
) {
  if (cache.has(sku)) return
  await prisma.catalog.upsert({
    where: {
      org_id_sku: {
        org_id: orgId,
        sku,
      },
    },
    update: {
      name: productName,
      updated_at: new Date(),
    },
    create: {
      org_id: orgId,
      sku,
      name: productName,
    },
  })
  cache.add(sku)
}

async function flushSales(
  batch: Parameters<typeof prisma.sales_events.createMany>[0]['data'],
) {
  if (!batch.length) return
  await prisma.sales_events.createMany({
    data: batch,
    skipDuplicates: true,
  })
}

async function flushStock(
  batch: Parameters<typeof prisma.stock_snapshots.createMany>[0]['data'],
) {
  if (!batch.length) return
  await prisma.stock_snapshots.createMany({
    data: batch.map((row) => ({
      ...row,
      updated_at: new Date(),
    })),
    skipDuplicates: true,
  })
}

function buildWarehouseId(name: string) {
  const hash = createHash('md5').update(name.trim().toLowerCase()).digest('hex').slice(0, 8)
  return `WH-${hash}`.toUpperCase()
}

function buildOrderId(rec: ParsedRow, warehouseId: string) {
  const datePart = formatISO(rec.date, { representation: 'date' })
  return `turn-${datePart}-${warehouseId}-${rec.sku}`
}

main().catch((error) => {
  console.error('❌ Import failed:', error)
  prisma.$disconnect().finally(() => process.exit(1))
})
