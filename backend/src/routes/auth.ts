import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, AuthUser } from '../middleware/auth'
import { issueToken, validateCredentials, createOrgAndUser, rotateApiKey } from '../modules/auth/service'
import { prisma } from '../db/client'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

const registerSchema = z.object({
  org_name: z.string().min(2),
  warehouse_name: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(6),
})

export const authRouter = Router()

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }
  const email = parsed.data.email.trim().toLowerCase()
  const { password } = parsed.data

  const user = await validateCredentials(email, password)
  if (!user) {
    return res.status(401).json({ error: 'Невірний email або пароль' })
  }

  const token = issueToken(user)
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      org_id: user.org_id,
      role: user.role,
    },
  })
})

authRouter.get('/me', authMiddleware, (req, res) => {
  const user = req.user as AuthUser | undefined
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  return res.json({ user })
})

authRouter.get('/api-key', authMiddleware, async (req, res) => {
  const user = req.user as AuthUser | undefined
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const org = await prisma.orgs.findUnique({
    where: { id: user.orgId },
    select: { api_key: true },
  })
  if (!org) return res.status(404).json({ error: 'Організацію не знайдено' })
  return res.json({ api_key: org.api_key })
})

authRouter.post('/api-key/rotate', authMiddleware, async (req, res) => {
  const user = req.user as AuthUser | undefined
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const newKey = await rotateApiKey(user.orgId)
  return res.json({ api_key: newKey })
})

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }

  try {
    const { org, user } = await createOrgAndUser({
      orgName: parsed.data.org_name,
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      warehouseName: parsed.data.warehouse_name,
    })

    const token = issueToken(user)
    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        org_id: org.id,
        role: user.role,
        name: user.name,
      },
    })
  } catch (error: any) {
    const status = error.statusCode ?? 500
    return res.status(status).json({ error: error.message ?? 'Не вдалося створити користувача' })
  }
})
