import { prisma } from '../src/db/client'

type DeleteSummary = {
  table: string
  count: number
}

type CliArgs = {
  warehouseIds: string[]
}

function parseArgs(): CliArgs {
  const ids = process.argv
    .slice(2)
    .filter((arg) => arg && !arg.startsWith('-'))
    .map((arg) => arg.trim())
    .filter(Boolean)

  if (!ids.length) {
    console.error('Usage: npx tsx scripts/delete-warehouse.ts <WAREHOUSE_ID> [<WAREHOUSE_ID> ...]')
    process.exit(1)
  }

  return { warehouseIds: Array.from(new Set(ids)) }
}

async function deleteWarehouse(warehouseId: string) {
  const warehouse = await prisma.warehouses.findUnique({ where: { id: warehouseId } })

  if (!warehouse) {
    console.warn(`⚠️  Warehouse "${warehouseId}" not found, skipping.`)
    return
  }

  console.log(`🧹 Removing warehouse ${warehouseId} (${warehouse.name}) for org ${warehouse.org_id}`)

  const summary = await prisma.$transaction(async (tx) => {
    const deletions: DeleteSummary[] = []
    const pushResult = async (table: DeleteSummary['table'], action: Promise<{ count: number }>) => {
      const result = await action
      deletions.push({ table, count: result.count })
    }

    await pushResult(
      'recommendations',
      tx.recommendations.deleteMany({
        where: { org_id: warehouse.org_id, warehouse_id: warehouseId },
      }),
    )

    await pushResult(
      'buffers',
      tx.buffers.deleteMany({
        where: { org_id: warehouse.org_id, warehouse_id: warehouseId },
      }),
    )

    await pushResult(
      'stock_snapshots',
      tx.stock_snapshots.deleteMany({
        where: { org_id: warehouse.org_id, warehouse_id: warehouseId },
      }),
    )

    await pushResult(
      'sales_daily',
      tx.sales_daily.deleteMany({
        where: { org_id: warehouse.org_id, warehouse_id: warehouseId },
      }),
    )

    await pushResult(
      'sales_events',
      tx.sales_events.deleteMany({
        where: { org_id: warehouse.org_id, warehouse_id: warehouseId },
      }),
    )

    await tx.warehouses.delete({ where: { id: warehouseId } })

    return deletions
  })

  for (const row of summary) {
    console.log(`   • ${row.table}: deleted ${row.count.toLocaleString()} rows`)
  }

  console.log(`✅ Warehouse ${warehouseId} removed.`)
}

async function main() {
  const { warehouseIds } = parseArgs()

  for (const warehouseId of warehouseIds) {
    await deleteWarehouse(warehouseId)
  }
}

main()
  .catch((err) => {
    console.error('❌ Failed to delete warehouse:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
