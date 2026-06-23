export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Array<{ field: string; message: string }>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(fields: Array<{ field: string; message: string }>) {
    super(400, 'VALIDATION_ERROR', 'Validation failed', fields)
    this.name = 'ValidationError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message)
    this.name = 'ConflictError'
  }
}

export class GoneError extends AppError {
  constructor(message = 'Gone', code = 'GONE') {
    super(410, code, message)
    this.name = 'GoneError'
  }
}
