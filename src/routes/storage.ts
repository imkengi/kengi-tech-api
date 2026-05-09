import { Router } from 'express'
import multer from 'multer'
import { Storage } from '@google-cloud/storage'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { getStorePrisma } from '../lib/prisma'

const router = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

function storePrefix(req: AuthRequest): string {
    const schema = req.user?.branchSchema || req.user?.storeSchema
    if (!schema || !/^[a-z0-9_]+$/.test(schema)) {
        throw new Error('Missing or invalid store schema')
    }
    return schema
}

router.post('/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
        const { category, referenceId, referenceName, description } = req.body
        const prisma = req.storePrisma!
        const prefix = storePrefix(req)

        let publicUrl = ''

        if (process.env.GCS_BUCKET) {
             const storageGCS = new Storage()
             const bucket = storageGCS.bucket(process.env.GCS_BUCKET)
             const ext = path.extname(req.file.originalname) || ''
             const filename = `${prefix}/vault/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
             const gcsFile = bucket.file(filename)
             await gcsFile.save(req.file.buffer, { contentType: req.file.mimetype, resumable: false })

             const baseUrl = process.env.GCS_BASE_URL || `https://storage.googleapis.com/${process.env.GCS_BUCKET}`
             publicUrl = `${baseUrl}/${filename}`
        } else {
             const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads')
             const storeDir = path.join(UPLOADS_DIR, prefix)
             if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true })
             const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(req.file.originalname) || ''}`
             fs.writeFileSync(path.join(storeDir, filename), req.file.buffer)
             const baseUrlLocal = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
             publicUrl = `${baseUrlLocal}/uploads/${prefix}/${filename}`
        }
        
        const newFile = await prisma.storageFile.create({
            data: {
                name: req.file.originalname,
                url: publicUrl,
                size: req.file.size,
                type: req.file.mimetype,
                category: category || 'internal',
                referenceId: referenceId || null,
                referenceName: referenceName || null,
                description: description || null,
                uploadedBy: req.user?.email || 'System'
            }
        })
        res.json(newFile)
    } catch (err: any) {
        console.error('Storage Upload Error:', err)
        res.status(500).json({ error: err.message })
    }
})

router.get('/files', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const prisma = req.storePrisma!
        const files = await prisma.storageFile.findMany({ orderBy: { createdAt: 'desc' } })
        res.json({ data: files.map(f => ({ ...f, uploadedAt: f.createdAt.toISOString() })) })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/files/:id', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const prisma = req.storePrisma!
        const prefix = storePrefix(req)
        const targetId = String(req.params.id)

        // The storageFile row lives in the caller's per-store schema, so just
        // looking it up via req.storePrisma already enforces store scoping.
        const file = await prisma.storageFile.findUnique({ where: { id: targetId }})
        if (file) {
           if (!process.env.GCS_BUCKET) {
               const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads')
               const storeDir = path.resolve(UPLOADS_DIR, prefix)
               // Try resolving the URL against the store's own subdirectory only.
               const tail = file.url.split('/uploads/').pop() || ''
               if (tail && tail.startsWith(prefix + '/')) {
                   const localPath = path.resolve(UPLOADS_DIR, tail)
                   if (localPath.startsWith(storeDir + path.sep) && fs.existsSync(localPath)) {
                       try { fs.unlinkSync(localPath) } catch(e){}
                   }
               }
           }
           await prisma.storageFile.delete({ where: { id: targetId } })
        }
        res.json({ success: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

export default router
