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

router.post('/upload', authMiddleware, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
        const { category, referenceId, referenceName, description } = req.body
        const prisma = req.storePrisma!
        
        let publicUrl = ''
        
        if (process.env.GCS_BUCKET) {
             const storageGCS = new Storage()
             const bucket = storageGCS.bucket(process.env.GCS_BUCKET)
             const ext = path.extname(req.file.originalname) || ''
             const filename = `vault/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`
             const gcsFile = bucket.file(filename)
             await gcsFile.save(req.file.buffer, { contentType: req.file.mimetype, resumable: false })
             
             const baseUrl = process.env.GCS_BASE_URL || `https://storage.googleapis.com/${process.env.GCS_BUCKET}`
             publicUrl = `${baseUrl}/${filename}`
        } else {
             const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads')
             if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })
             const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(req.file.originalname) || ''}`
             fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer)
             const baseUrlLocal = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`
             publicUrl = `${baseUrlLocal}/uploads/${filename}`
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
        const targetId = String(req.params.id)
        const file = await prisma.storageFile.findUnique({ where: { id: targetId }})
        if (file) {
           const filename = file.url.split('/').pop()
           if (filename && !process.env.GCS_BUCKET) {
               const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads')
               const localPath = path.join(UPLOADS_DIR, filename)
               if (fs.existsSync(localPath)) {
                   try { fs.unlinkSync(localPath) } catch(e){}
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
