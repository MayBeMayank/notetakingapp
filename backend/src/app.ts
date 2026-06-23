import express, { type Express } from 'express'
import { authRouter } from './routes/auth.routes.js'
import { publicRouter } from './routes/public.routes.js'
import { notesRouter } from './routes/notes.routes.js'
import { tagsRouter } from './routes/tags.routes.js'
import { sharesRouter } from './routes/shares.routes.js'
import { authMiddleware } from './middleware/auth.middleware.js'
import { errorMiddleware } from './middleware/error.middleware.js'

const app: Express = express()
app.use(express.json())

// Public routes — mounted before the auth guard
app.use('/api/auth', authRouter)
app.use('/api/public', publicRouter)

// Auth middleware — guards all routes mounted after this point
app.use(authMiddleware)

app.use('/api/notes', notesRouter)
app.use('/api/tags', tagsRouter)
app.use('/api/shares', sharesRouter)

// Central error handler — must be last
app.use(errorMiddleware)

export { app }
