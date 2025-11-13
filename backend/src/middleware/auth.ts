import { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { prisma } from '../db/client'

export type AuthUser = {
  userId: string
  orgId: string
  role: string
  email: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

function extractToken(req: Request) {
  const header = req.headers.authorization
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (!token || scheme.toLowerCase() !== 'bearer') return null
  return token
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Authorization header missing' })
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload
    req.user = {
      userId: payload.sub as string,
      orgId: (payload as any).orgId,
      role: (payload as any).role,
      email: (payload as any).email,
    }
    return next()
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export async function getOrgIdFromRequest(req: Request, provided?: string) {
  if (req.user?.orgId) {
    if (provided && provided !== req.user.orgId) {
      throw Object.assign(new Error('org_id does not match your session'), { statusCode: 403 })
    }
    return req.user.orgId
  }

  const apiKeyHeader = (req.headers['x-api-key'] ?? req.headers['x-api-key'.toLowerCase()]) as
    | string
    | undefined
  const apiKey = apiKeyHeader?.trim()
  if (apiKey) {
    const org = await prisma.orgs.findUnique({
      where: { api_key: apiKey },
    })
    if (!org) {
      throw Object.assign(new Error('Invalid API key'), { statusCode: 401 })
    }
    if (provided && provided !== org.id) {
      throw Object.assign(new Error('org_id does not match API key'), { statusCode: 403 })
    }
    return org.id
  }

  throw Object.assign(new Error('org_id or API key is required'), { statusCode: 400 })
}
