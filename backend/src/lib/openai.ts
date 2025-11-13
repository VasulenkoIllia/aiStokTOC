import OpenAI from 'openai'
import { env } from '../config/env'
import { logger } from '../config/logger'

let client: OpenAI | undefined

if (env.OPENAI_API_KEY) {
  client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  logger.info('OpenAI клієнт ініціалізовано')
} else {
  logger.warn('OPENAI_API_KEY не заданий. /assistant/* працюватимуть у мок-режимі.')
}

export const openaiClient = client
