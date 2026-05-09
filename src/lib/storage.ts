import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'

// ─── Google Cloud Storage Helper ────────────────────────────────────────────
// Generates signed URLs for direct client-side uploads.
// Graceful fallback: if GCS_BUCKET is not set, returns error.

const BUCKET_NAME = process.env.GCS_BUCKET       // e.g. kengi-tech-uploads
const GCS_BASE_URL = process.env.GCS_BASE_URL    // e.g. https://storage.googleapis.com/kengi-tech-uploads

let storage: Storage | null = null
let bucket: any = null

if (BUCKET_NAME) {
    try {
        storage = new Storage()
        bucket = storage.bucket(BUCKET_NAME)
        console.log(`✅ Cloud Storage enabled (bucket: ${BUCKET_NAME})`)
    } catch (err: any) {
        console.warn('⚠️ Cloud Storage init failed:', err.message)
    }
} else {
    console.log('ℹ️ GCS_BUCKET not set — file upload via signed URLs disabled')
}

export interface SignedUrlResult {
    /** Pre-signed URL for uploading (PUT request) */
    uploadUrl: string
    /** Public URL to access the file after upload */
    publicUrl: string
    /** Generated filename */
    filename: string
}

/**
 * Generate a signed URL for direct file upload from the client.
 *
 * @param folder - Folder path (e.g. "products", "imports")
 * @param originalName - Original file name
 * @param contentType - MIME type (e.g. "image/jpeg", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
 * @param expiresMinutes - How long the URL is valid (default: 15 min)
 */
export async function getSignedUploadUrl(
    folder: string,
    originalName: string,
    contentType: string,
    expiresMinutes: number = 15,
): Promise<SignedUrlResult> {
    if (!storage || !bucket || !BUCKET_NAME) {
        throw new Error('Cloud Storage not configured (set GCS_BUCKET env var)')
    }
    if (folder.includes('..') || folder.startsWith('/') || folder.includes('\\')) {
        throw new Error('Invalid folder path')
    }

    // Generate unique filename: folder/timestamp-random-originalname
    const ext = originalName.split('.').pop() || ''
    const hash = crypto.randomBytes(6).toString('hex')
    const timestamp = Date.now()
    const filename = `${folder}/${timestamp}-${hash}.${ext}`

    const file = bucket.file(filename)

    const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresMinutes * 60 * 1000,
        contentType,
    })

    const baseUrl = GCS_BASE_URL || `https://storage.googleapis.com/${BUCKET_NAME}`
    const publicUrl = `${baseUrl}/${filename}`

    return {
        uploadUrl: signedUrl,
        publicUrl,
        filename,
    }
}

/**
 * Delete a file from Cloud Storage.
 */
export async function deleteFile(filename: string): Promise<void> {
    if (!bucket) {
        throw new Error('Cloud Storage not configured')
    }
    await bucket.file(filename).delete().catch(() => { })
}

/**
 * Check if Cloud Storage is configured.
 */
export function isStorageEnabled(): boolean {
    return !!bucket
}
