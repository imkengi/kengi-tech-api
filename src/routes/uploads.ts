import { Router, Request, Response } from 'express'
import { authMiddleware } from '../middleware/auth'
import { requireRole } from '../middleware/roleMiddleware'
import { getSignedUploadUrl, deleteFile, isStorageEnabled } from '../lib/storage'

const router = Router()

// ─── GET /api/uploads/status ─────────────────────────────────────────────────
// Check if Cloud Storage is configured
router.get('/status', authMiddleware, (_req: Request, res: Response) => {
    res.json({ success: true, data: { enabled: isStorageEnabled() } })
})

// ─── POST /api/uploads/signed-url ────────────────────────────────────────────
// Request a signed URL for direct upload to Cloud Storage
router.post('/signed-url', authMiddleware, async (req: Request, res: Response) => {
    try {
        const { folder = 'general', filename, contentType } = req.body

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ success: false, error: 'filename is required' })
        }
        // Prevent path traversal in folder/filename
        if (folder.includes('..') || filename.includes('..')) {
            return res.status(400).json({ success: false, error: 'Invalid path' })
        }
        if (!contentType) {
            return res.status(400).json({ success: false, error: 'contentType is required' })
        }

        // Allowed content types
        const allowed = [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
            'application/vnd.ms-excel', // xls
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
// Delete a file from Cloud Storage
router.delete('/:filename(*)', authMiddleware, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
    try {
        const filename = String(req.params.filename)
        if (!filename || filename.includes('..') || filename.startsWith('/')) {
            return res.status(400).json({ success: false, error: 'Invalid filename' })
        }
        await deleteFile(String(filename))
        res.json({ success: true, message: 'File deleted' })
    } catch (err: any) {
        console.error('Delete file error:', err)
        res.status(500).json({ success: false, error: err.message || 'Failed to delete file' })
    }
})

export default router
