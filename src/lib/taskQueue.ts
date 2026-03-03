import { CloudTasksClient } from '@google-cloud/tasks'

// ─── Cloud Tasks Helper ─────────────────────────────────────────────────────
// Enqueues background tasks via Google Cloud Tasks.
// Graceful fallback: if CLOUD_TASKS_QUEUE is not set, executes inline.

const QUEUE = process.env.CLOUD_TASKS_QUEUE     // e.g. projects/kengi-tech/locations/asia-southeast1/queues/default
const SERVICE_URL = process.env.CLOUD_RUN_URL    // e.g. https://kengi-tech-api-xxx.run.app

let tasksClient: CloudTasksClient | null = null

if (QUEUE && SERVICE_URL) {
    try {
        tasksClient = new CloudTasksClient()
        console.log('✅ Cloud Tasks enabled')
    } catch (err: any) {
        console.warn('⚠️ Cloud Tasks init failed:', err.message)
    }
} else {
    console.log('ℹ️ Cloud Tasks not configured — heavy tasks will run inline')
}

export interface TaskOptions {
    /** Delay before executing (seconds) */
    delaySeconds?: number
    /** HTTP method (default: POST) */
    method?: 'POST' | 'PUT'
}

/**
 * Enqueue a background task.
 *
 * @param path - API path for the worker endpoint (e.g. /api/_worker/import)
 * @param payload - JSON body to send
 * @param options - delay, method
 * @returns taskId if enqueued, null if executed inline
 */
export async function enqueueTask(
    path: string,
    payload: any,
    options: TaskOptions = {}
): Promise<string | null> {
    const { delaySeconds = 0, method = 'POST' } = options

    // Fallback: execute inline via fetch
    if (!tasksClient || !QUEUE || !SERVICE_URL) {
        console.log(`[TaskQueue] No Cloud Tasks — executing ${path} inline`)
        try {
            const url = `${SERVICE_URL || 'http://localhost:${process.env.PORT || 3001}'}${path}`
            await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', 'X-CloudTasks-TaskName': 'inline' },
                body: JSON.stringify(payload),
            })
        } catch (err: any) {
            console.error(`[TaskQueue] Inline execution failed:`, err.message)
        }
        return null
    }

    try {
        const task: any = {
            httpRequest: {
                httpMethod: method,
                url: `${SERVICE_URL}${path}`,
                headers: { 'Content-Type': 'application/json' },
                body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            },
        }

        if (delaySeconds > 0) {
            task.scheduleTime = {
                seconds: Math.floor(Date.now() / 1000) + delaySeconds,
            }
        }

        const [response] = await tasksClient.createTask({ parent: QUEUE, task })
        const taskId = response.name?.split('/').pop() || 'unknown'
        console.log(`[TaskQueue] Enqueued task ${taskId} → ${path}`)
        return taskId
    } catch (err: any) {
        console.error(`[TaskQueue] Failed to enqueue:`, err.message)
        return null
    }
}
