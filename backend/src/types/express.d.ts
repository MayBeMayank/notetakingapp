declare global {
  namespace Express {
    interface Request {
      userId: string
      validatedQuery?: unknown
    }
  }
}

export {}
