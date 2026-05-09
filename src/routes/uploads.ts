import { Router, Request, Response } from 'express'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { getSignedUploadUrl, deleteFile, isStorageEnabled } from '../lib/storage'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

const router = Router()

// ─── Local uploads directory ─────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

// Schema names are validated to [a-z0-9_]+ before reaching here, so they are
// safe to use as path segments — but double-check before constructing paths.
function storePrefix(req: AuthRequest): string {
    const schema = req.user?.branchSchema || req.user?.storeSchema
    if (!schema || !/^[a-z0-9_]+$/.test(schema)) {
        throw new Error('Missing or invalid store schema')
    }
    return schema
}

function ensureStoreDir(prefix: string): string {
    const dir = path.join(UPLOADS_DIR, prefix)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
}

// Multer config — files land in a per-store subdirectory.
const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        try {
            const prefix = storePrefix(req as AuthRequest)
            cb(null, ensureStoreDir(prefix))
        } catch (err: any) {
            cb(err, '')
        }
    },
    filename: (_req, file, cb) => {
        const hash = crypto.randomBytes(8).toString('hex')
        const ext = path.extname(file.originalname) || '.jpg'
        cb(null, `${Date.now()}-${hash}${ext}`)
    }
})
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
        cb(null, allowed.includes(file.mimetype))
    }
})

async function recordStorageFile(
    req: AuthRequest,
    args: { name: string; url: string; size: number; type: string; category?: string },
): Promise<void> {
    const prisma = req.storePrisma
    if (!prisma) return
    try {
        await prisma.storageFile.create({
            data: {
                name: args.name,
                url: args.url,
                size: args.size,
                type: args.type,
                category: args.category || 'upload',
                uploadedBy: req.user?.email || 'System',
            },
        })
    } catch (err: any) {
        // Don't fail the upload if metadata write fails — but log it.
        console.warn('StorageFile.create failed:', err?.message || err)
    }
}

// ─── GET /api/uploads/status ─────────────────────────────────────────────────
router.get('/status', authMiddleware, (_req: Request, res: Response) => {
    res.json({ success: true, data: { enabled: true, gcs: isStorageEnabled() } })
})

// ─── POST /api/uploads/direct ────────────────────────────────────────────────
// Direct file upload via multipart form data (works without GCS)
router.post('/direct', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' })
        }

        const prefix = storePrefix(req)
        const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
        const relPath = `${prefix}/${req.file.filename}`
        const publicUrl = `${baseUrl}/uploads/${relPath}`

        await recordStorageFile(req, {
            name: req.file.originalname,
            url: publicUrl,
            size: req.file.size,
            type: req.file.mimetype,
        })

        res.json({
            success: true,
            data: {
                url: publicUrl,
                filename: relPath,
                size: req.file.size,
                mimetype: req.file.mimetype,
            }
        })
    } catch (err: any) {
        console.error('Direct upload error:', err)
        res.status(500).json({ success: false, error: err.message || 'Upload failed' })
    }
})

// ─── POST /api/uploads/base64 ────────────────────────────────────────────────
// Upload a base64-encoded image
router.post('/base64', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { data, filename: origName } = req.body
        if (!data || typeof data !== 'string') {
            return res.status(400).json({ success: false, error: 'data (base64 string) is required' })
        }

        // Parse data URL: data:image/jpeg;base64,...
        const match = data.match(/^data:(image\/\w+);base64,(.+)$/)
        if (!match) {
            return res.status(400).json({ success: false, error: 'Invalid base64 image data' })
        }

        const mimeType = match[1]
        const base64Data = match[2]
        const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : mimeType === 'image/gif' ? '.gif' : '.jpg'
        const hash = crypto.randomBytes(8).toString('hex')
        const fname = `${Date.now()}-${hash}${ext}`

        const prefix = storePrefix(req)
        const dir = ensureStoreDir(prefix)
        const buf = Buffer.from(base64Data, 'base64')
        fs.writeFileSync(path.join(dir, fname), buf)

        const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
        const relPath = `${prefix}/${fname}`
        const publicUrl = `${baseUrl}/uploads/${relPath}`

        await recordStorageFile(req, {
            name: typeof origName === 'string' ? origName : fname,
            url: publicUrl,
            size: buf.length,
            type: mimeType,
        })

        res.json({
            success: true,
            data: {
                url: publicUrl,
                filename: relPath,
            }
        })
    } catch (err: any) {
        console.error('Base64 upload error:', err)
        res.status(500).json({ success: false, error: err.message || 'Upload failed' })
    }
})

// ─── POST /api/uploads/signed-url ────────────────────────────────────────────
// Request a signed URL for direct upload to Cloud Storage (requires GCS).
// The folder is forced to the caller's store prefix — client cannot pick it.
router.post('/signed-url', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
        const { folder = 'general', filename, contentType } = req.body

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ success: false, error: 'filename is required' })
        }
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ success: false, error: 'Invalid filename' })
        }
        if (typeof folder !== 'string' || folder.includes('..') || folder.includes('/') || folder.includes('\\')) {
            return res.status(400).json({ success: false, error: 'Invalid folder' })
        }
        if (!contentType) {
            return res.status(400).json({ success: false, error: 'contentType is required' })
        }

        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv',
        ]
        if (!allowed.includes(contentType)) {
            return res.status(400).json({ success: false, error: `Content type '${contentType}' not allowed` })
        }

        const prefix = storePrefix(req)
        const scopedFolder = `${prefix}/${folder}`
        const result = await getSignedUploadUrl(scopedFolder, filename, contentType)
        res.json({ success: true, data: result })
    } catch (err: any) {
        console.error('Signed URL error:', err)
        res.status(500).json({ success: false, error: err.message || 'Failed to generate signed URL' })
    }
})

// ─── DELETE /api/uploads/:filename ───────────────────────────────────────────
// The caller may only delete files inside their own store prefix.
router.delete('/:filename(*)', authMiddleware, requireRole('admin', 'manager'), async (req: AuthRequest, res: Response) => {
    try {
        const filename = String(req.params.filename || '').replace(/^\/+/, '')
        if (!filename || filename.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid filename' })
        }

        const prefix = storePrefix(req)
        if (!filename.startsWith(prefix + '/')) {
            return res.status(403).json({ success: false, error: 'You can only delete files in your own store' })
        }

        // Resolve and confirm the path stays inside the store's local directory.
        const storeDir = path.resolve(UPLOADS_DIR, prefix)
        const localPath = path.resolve(UPLOADS_DIR, filename)
        if (!localPath.startsWith(storeDir + path.sep) && localPath !== storeDir) {
            return res.status(400).json({ success: false, error: 'Invalid path' })
        }

        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath)
            return res.json({ success: true, message: 'File deleted' })
        }

        // GCS path is already store-prefixed by the upload routes.
        await deleteFile(filename)
        res.json({ success: true, message: 'File deleted' })
    } catch (err: any) {
        console.error('Delete file error:', err)
        res.status(500).json({ success: false, error: err.message || 'Failed to delete file' })
    }
})

export default router
