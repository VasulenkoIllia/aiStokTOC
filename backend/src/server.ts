import { env } from './config/env'
import { buildApp } from './app'
import { logger } from './config/logger'

function start() {
  const app = buildApp()
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info(`API слухає порт ${env.PORT}`)
  })

  server.on('error', (err) => {
    logger.error(err, 'Помилка запуску API')
    process.exit(1)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start()
}
