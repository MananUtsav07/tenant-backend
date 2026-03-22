import { env } from './config/env.js'
import { app } from './app.js'

app.listen(env.PORT, () => {
  console.log(`[server] tenant-backend listening on port ${env.PORT}`)
  console.log(`[server] allowed origins: ${env.ALLOWED_ORIGIN_LIST.join(', ')}`)
})
