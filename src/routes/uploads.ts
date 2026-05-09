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

// Multer config for local storage
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
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

        // Build public URL
        const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
        const publicUrl = `${baseUrl}/uploads/${req.file.filename}`

        res.json({
            success: true,
            data: {
                url: publicUrl,
                filename: req.file.filename,
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

        fs.writeFileSync(path.join(UPLOADS_DIR, fname), Buffer.from(base64Data, 'base64'))

        const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
        const publicUrl = `${baseUrl}/uploads/${fname}`

        res.json({
            success: true,
            data: {
                url: publicUrl,
                filename: fname,
            }
        })
    } catch (err: any) {
        console.error('Base64 upload error:', err)
        res.status(500).json({ success: false, error: err.message || 'Upload failed' })
    }
})

// ─── POST /api/uploads/signed-url ────────────────────────────────────────────
// Request a signed URL for direct upload to Cloud Storage (requires GCS)
router.post('/signed-url', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { folder = 'general', filename, contentType } = req.body

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ success: false, error: 'filename is required' })
        }
        if (folder.includes('..') || filename.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid path' })
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

        const result = await getSignedUploadUrl(folder, filename, contentType)
        res.json({ success: true, data: result })
    } catch (err: any) {
        console.error('Signed URL error:', err)
        res.status(500).json({ success: false, error: err.message || 'Failed to generate signed URL' })
    }
})

// ─── DELETE /api/uploads/:filename ───────────────────────────────────────────
router.delete('/:filename(*)', authMiddleware, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
        const filename = String(req.params.filename)
        if (!filename || filename.includes('..') || filename.startsWith('/')) {
            return res.status(400).json({ success: false, error: 'Invalid filename' })
        }

        // Try deleting from local storage first
        const localPath = path.join(UPLOADS_DIR, path.basename(filename))
        if (fs.existsSync(localPath)) {
            fs.unlinkSync(localPath)
            return res.json({ success: true, message: 'File deleted' })
        }

        // Try GCS
        await deleteFile(String(filename))
        res.json({ success: true, message: 'File deleted' })
    } catch (err: any) {
        console.error('Delete file error:', err)
        res.status(500).json({ success: false, error: err.message || 'Failed to delete file' })
    }
})

export default router
