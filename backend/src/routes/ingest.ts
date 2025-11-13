import { Router } from 'express'
import {
  catalogIngestSchema,
  poHeaderIngestSchema,
  poLinesIngestSchema,
  salesIngestSchema,
  stockIngestSchema,
  warehousesIngestSchema,
  suppliersIngestSchema,
} from '../modules/ingest/schemas'
import {
  importCatalog,
  importPoHeaders,
  importPoLines,
  importSales,
  importStock,
  importWarehouses,
  importSuppliers,
} from '../modules/ingest/service'
import { getOrgIdFromRequest } from '../middleware/auth'

export const ingestRouter = Router()

ingestRouter.post('/catalog', async (req, res) => {
  const parsed = catalogIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importCatalog({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/sales_report', async (req, res) => {
  const parsed = salesIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importSales({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/stock', async (req, res) => {
  const parsed = stockIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importStock({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/po_header', async (req, res) => {
  const parsed = poHeaderIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importPoHeaders({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/po_lines', async (req, res) => {
  const parsed = poLinesIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importPoLines({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/warehouses', async (req, res) => {
  const parsed = warehousesIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importWarehouses({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})

ingestRouter.post('/suppliers', async (req, res) => {
  const parsed = suppliersIngestSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message })
  try {
    const orgId = await getOrgIdFromRequest(req, parsed.data.org_id)
    const result = await importSuppliers({ ...parsed.data, org_id: orgId })
    return res.status(202).json(result)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})
