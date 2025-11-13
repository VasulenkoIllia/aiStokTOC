import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { prisma } from '../../db/client'
import { env } from '../../config/env'

const TOKEN_TTL = '1d'

export async function validateCredentials(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const user = await prisma.users.findFirst({
    where: { email: normalizedEmail },
  })

  if (!user) return null

  const match = await bcrypt.compare(password, user.password_hash)
  if (!match) return null

  return user
}

export function issueToken(user: { id: string; org_id: string; role: string; email: string }) {
  return jwt.sign(
    {
      orgId: user.org_id,
      role: user.role,
      email: user.email,
    },
    env.JWT_SECRET,
    {
      subject: user.id,
      expiresIn: TOKEN_TTL,
    },
  )
}

type RegisterInput = {
  orgName: string
  email: string
  password: string
  name?: string
  warehouseName?: string
}

export async function createOrgAndUser(input: RegisterInput) {
  const email = input.email.trim().toLowerCase()
  const existingUser = await prisma.users.findFirst({
    where: { email },
  })
  if (existingUser) {
    throw Object.assign(new Error('Користувач із таким email вже існує'), { statusCode: 409 })
  }

  const orgId = generateOrgId(input.orgName)
  const apiKey = generateApiKey()
  const warehouseId = `${orgId}-wh-${randomUUID().slice(0, 4)}`
  const passwordHash = await bcrypt.hash(input.password, 10)

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.orgs.create({
      data: {
        id: orgId,
        name: input.orgName,
        api_key: apiKey,
      },
    })

    await tx.warehouses.create({
      data: {
        id: warehouseId,
        org_id: orgId,
        name: input.warehouseName?.trim() || 'Основний склад',
        timezone: 'UTC',
      },
    })

    const user = await tx.users.create({
      data: {
        org_id: orgId,
        email,
        name: input.name?.trim() || 'Адміністратор',
        password_hash: passwordHash,
        role: 'admin',
      },
    })

    return { org, user }
  })

  return result
}

function generateOrgId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  const suffix = randomUUID().slice(0, 4)
  return slug ? `${slug}-${suffix}` : `org-${suffix}`
}

function generateApiKey() {
  return `wa_${randomUUID().replace(/-/g, '')}`
}

export async function rotateApiKey(orgId: string) {
  const newKey = generateApiKey()
  await prisma.orgs.update({
    where: { id: orgId },
    data: { api_key: newKey },
  })
  return newKey
}
