import 'dotenv/config'
import { app } from './app.js'

if (!process.env['JWT_SECRET']) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.')
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3000)
app.listen(port, () => {
  console.log(`Server listening on port ${port}`)
})
