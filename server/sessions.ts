import { Application, Request, Response } from 'express'
import { ServerContext } from './index'
import { listSessions } from '../core/sessions'

export function registerSessionsRoutes(app: Application, _ctx: ServerContext): void {
    app.get('/api/sessions', (_req: Request, res: Response) => {
        const sessions = listSessions()
        const currentId = process.env.MEDDLE_SESSION_ID || null
        const currentPort = Number(process.env.PORT) || 8989
        res.json({
            current: {
                id: currentId,
                port: currentPort,
                isDefault: !currentId,
            },
            sessions,
        })
    })
}
