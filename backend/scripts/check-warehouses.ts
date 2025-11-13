import { prisma } from '../src/db/client'

async function main() {
  const rows = await prisma.warehouses.findMany({
    where: { org_id: 'demo-org' },
    select: { id: true, name: true },
    take: 20,
    orderBy: { name: 'asc' }
  })
  console.log(rows)
}

main().finally(() => prisma.$disconnect())
