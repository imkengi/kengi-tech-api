import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

/**
 * Generic Zod validation middleware factory.
 * Usage: router.post('/', validate(MySchema), handler)
 */
export function validate(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.body)
        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message,
            }))
            return res.status(400).json({ success: false, error: 'Validation failed', errors })
        }
        req.body = result.data // sanitized & typed
        next()
    }
}

/**
 * Validate query params instead of body
 */
export function validateQuery(schema: ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
        const result = schema.safeParse(req.query)
        if (!result.success) {
            const errors = result.error.errors.map(e => ({
                field: e.path.join('.'),
                message: e.message,
            }))
            return res.status(400).json({ success: false, error: 'Invalid query parameters', errors })
        }
        req.query = result.data as any
        next()
    }
}
