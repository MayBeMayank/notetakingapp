import express, { type Express } from 'express'
import { authRouter } from './routes/auth.routes.js'
import { authMiddleware } from './middleware/auth.middleware.js'
import { errorMiddleware } from './middleware/error.middleware.js'

const app: Express = express()
app.use(express.json())

// Public routes — mounted before the auth guard
app.use('/api/auth', authRouter)

// Auth middleware — guards all routes mounted after this point
app.use(authMiddleware)

// Central error handler — must be last
app.use(errorMiddleware)

export { app }
