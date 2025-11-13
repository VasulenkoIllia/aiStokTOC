import { z } from 'zod'

export const catalogItemSchema = z.object({
  sku: z.string(),
  name: z.string(),
  category: z.string().optional(),
  uom: z.string().optional(),
  shelf_life_days: z.number().int().positive().optional(),
})

export const salesEventSchema = z.object({
  order_id: z.string(),
  line_id: z.string(),
  order_datetime: z.string(),
  sku: z.string(),
  qty: z.number(),
  unit_price: z.number().optional(),
  discount_amount: z.number().optional(),
  net_amount: z.number().optional(),
  tax_amount: z.number().optional(),
  currency: z.string().optional(),
  warehouse_id: z.string().optional(),
  channel: z.string().optional(),
  status: z.string().optional(),
  returned_qty: z.number().optional(),
  canceled_qty: z.number().optional(),
  promo_code: z.string().optional(),
})

export const stockSnapshotSchema = z.object({
  date: z.string(),
  sku: z.string(),
  warehouse_id: z.string(),
  qty_on_hand: z.number(),
  batch_id: z.string().optional(),
  expiry_date: z.string().optional(),
})

export const poHeaderSchema = z.object({
  po_id: z.string(),
  supplier_id: z.string(),
  ordered_at: z.string(),
  received_at: z.string().optional(),
})

export const poLineSchema = z.object({
  po_id: z.string(),
  sku: z.string(),
  qty: z.number(),
  moq: z.number().optional(),
  pack_size: z.number().optional(),
})

const basePayload = { org_id: z.string().optional() }

export const catalogIngestSchema = z.object({
  ...basePayload,
  items: z.array(catalogItemSchema).min(1),
})
export type CatalogIngestInput = z.infer<typeof catalogIngestSchema>

export const salesIngestSchema = z.object({
  ...basePayload,
  items: z.array(salesEventSchema).min(1),
})
export type SalesIngestInput = z.infer<typeof salesIngestSchema>

export const stockIngestSchema = z.object({
  ...basePayload,
  items: z.array(stockSnapshotSchema).min(1),
})
export type StockIngestInput = z.infer<typeof stockIngestSchema>

export const poHeaderIngestSchema = z.object({
  ...basePayload,
  items: z.array(poHeaderSchema).min(1),
})
export type PoHeaderIngestInput = z.infer<typeof poHeaderIngestSchema>

export const poLinesIngestSchema = z.object({
  ...basePayload,
  items: z.array(poLineSchema).min(1),
})
export type PoLinesIngestInput = z.infer<typeof poLinesIngestSchema>

export const warehouseSchema = z.object({
  warehouse_id: z.string(),
  name: z.string(),
  timezone: z.string().optional(),
})

export const warehousesIngestSchema = z.object({
  ...basePayload,
  items: z.array(warehouseSchema).min(1),
})
export type WarehousesIngestInput = z.infer<typeof warehousesIngestSchema>

export const supplierSchema = z.object({
  supplier_id: z.string(),
  name: z.string(),
  lead_time_days_default: z.number().optional(),
  contact: z.string().optional(),
})

export const suppliersIngestSchema = z.object({
  ...basePayload,
  items: z.array(supplierSchema).min(1),
})
export type SuppliersIngestInput = z.infer<typeof suppliersIngestSchema>
