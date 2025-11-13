import { prisma } from '../../db/client'
import {
  CatalogIngestInput,
  PoHeaderIngestInput,
  PoLinesIngestInput,
  SalesIngestInput,
  StockIngestInput,
  WarehousesIngestInput,
  SuppliersIngestInput,
} from './schemas'

const DEFAULT_BATCH_ID = '_default'

function requireOrgId(orgId?: string) {
  if (!orgId) {
    throw new Error('org_id is required for ingest payload')
  }
  return orgId
}

export async function importCatalog(payload: CatalogIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.catalog.upsert({
        where: {
          org_id_sku: {
            org_id: orgId,
            sku: item.sku,
          },
        },
        update: {
          name: item.name,
          category: item.category ?? null,
          uom: item.uom ?? null,
          shelf_life_days: item.shelf_life_days ?? null,
          updated_at: new Date(),
        },
        create: {
          org_id: payload.org_id,
          sku: item.sku,
          name: item.name,
          category: item.category ?? null,
          uom: item.uom ?? null,
          shelf_life_days: item.shelf_life_days ?? null,
        },
      }),
    ),
  )

  return { processed: payload.items.length }
}

export async function importSales(payload: SalesIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.sales_events.upsert({
        where: {
          org_id_order_id_line_id: {
            org_id: orgId,
            order_id: item.order_id,
            line_id: item.line_id,
          },
        },
        update: {
          order_datetime: new Date(item.order_datetime),
          sku: item.sku,
          qty: item.qty ?? 0,
          unit_price: item.unit_price ?? null,
          discount_amount: item.discount_amount ?? null,
          net_amount: item.net_amount ?? null,
          tax_amount: item.tax_amount ?? null,
          currency: item.currency ?? 'UAH',
          warehouse_id: item.warehouse_id ?? null,
          channel: item.channel ?? null,
          status: item.status ?? null,
          returned_qty: item.returned_qty ?? 0,
          canceled_qty: item.canceled_qty ?? 0,
          promo_code: item.promo_code ?? null,
          updated_at: new Date(),
        },
        create: {
          org_id: payload.org_id,
          order_id: item.order_id,
          line_id: item.line_id,
          order_datetime: new Date(item.order_datetime),
          sku: item.sku,
          qty: item.qty ?? 0,
          unit_price: item.unit_price ?? null,
          discount_amount: item.discount_amount ?? null,
          net_amount: item.net_amount ?? null,
          tax_amount: item.tax_amount ?? null,
          currency: item.currency ?? 'UAH',
          warehouse_id: item.warehouse_id ?? null,
          channel: item.channel ?? null,
          status: item.status ?? null,
          returned_qty: item.returned_qty ?? 0,
          canceled_qty: item.canceled_qty ?? 0,
          promo_code: item.promo_code ?? null,
        },
      }),
    ),
  )

  return { processed: payload.items.length }
}

export async function importStock(payload: StockIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.stock_snapshots.upsert({
        where: {
          org_id_date_sku_warehouse_id_batch_id: {
            org_id: orgId,
            date: new Date(item.date),
            sku: item.sku,
            warehouse_id: item.warehouse_id,
            batch_id: item.batch_id ?? DEFAULT_BATCH_ID,
          },
        },
        update: {
          qty_on_hand: item.qty_on_hand ?? 0,
          expiry_date: item.expiry_date ? new Date(item.expiry_date) : null,
          updated_at: new Date(),
        },
        create: {
          org_id: payload.org_id,
          date: new Date(item.date),
          sku: item.sku,
          warehouse_id: item.warehouse_id,
          qty_on_hand: item.qty_on_hand ?? 0,
          batch_id: item.batch_id ?? DEFAULT_BATCH_ID,
          expiry_date: item.expiry_date ? new Date(item.expiry_date) : null,
        },
      }),
    ),
  )

  return { processed: payload.items.length }
}

export async function importPoHeaders(payload: PoHeaderIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.purchase_orders.upsert({
        where: {
          org_id_po_id: {
            org_id: orgId,
            po_id: item.po_id,
          },
        },
        update: {
          supplier_id: item.supplier_id,
          ordered_at: new Date(item.ordered_at),
          received_at: item.received_at ? new Date(item.received_at) : null,
        },
        create: {
          org_id: payload.org_id,
          po_id: item.po_id,
          supplier_id: item.supplier_id,
          ordered_at: new Date(item.ordered_at),
          received_at: item.received_at ? new Date(item.received_at) : null,
        },
      }),
    ),
  )

  return { processed: payload.items.length }
}

export async function importPoLines(payload: PoLinesIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.purchase_order_lines.upsert({
        where: {
          org_id_po_id_sku: {
            org_id: orgId,
            po_id: item.po_id,
            sku: item.sku,
          },
        },
        update: {
          qty: item.qty,
          moq: item.moq ?? null,
          pack_size: item.pack_size ?? null,
        },
        create: {
          org_id: payload.org_id,
          po_id: item.po_id,
          sku: item.sku,
          qty: item.qty,
          moq: item.moq ?? null,
          pack_size: item.pack_size ?? null,
        },
      }),
    ),
  )

  return { processed: payload.items.length }
}

export async function importWarehouses(payload: WarehousesIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.warehouses.upsert({
        where: {
          id: item.warehouse_id,
        },
        update: {
          name: item.name,
          timezone: item.timezone ?? undefined,
        },
        create: {
          id: item.warehouse_id,
          org_id: orgId,
          name: item.name,
          timezone: item.timezone ?? undefined,
        },
      }),
    ),
  )
  return { processed: payload.items.length }
}

export async function importSuppliers(payload: SuppliersIngestInput) {
  if (!payload.items.length) return { processed: 0 }
  const orgId = requireOrgId(payload.org_id)
  await prisma.$transaction(
    payload.items.map((item) =>
      prisma.suppliers.upsert({
        where: {
          id: item.supplier_id,
        },
        update: {
          name: item.name,
          lead_time_days_default: item.lead_time_days_default ?? undefined,
          contact: item.contact ?? undefined,
        },
        create: {
          id: item.supplier_id,
          org_id: orgId,
          name: item.name,
          lead_time_days_default: item.lead_time_days_default ?? undefined,
          contact: item.contact ?? undefined,
        },
      }),
    ),
  )
  return { processed: payload.items.length }
}
