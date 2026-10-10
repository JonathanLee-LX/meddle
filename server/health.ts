import { Application, Request, Response } from 'express'
import { ServerContext } from './index'

export function registerHealthRoutes(app: Application, ctx: ServerContext): void {
    /**
     * Side-effect-free reachability probe for the Web UI heartbeat (#105).
     * Must NOT call getRuntimeHealth()/snapshot() — that resets CPU sampling and
     * event-loop delay histograms shared with the watchdog.
     */
    app.get('/api/ping', (_req: Request, res: Response) => {
        res.status(204).end()
    })

    app.get('/api/health', (_req: Request, res: Response) => {
        const health = ctx.getRuntimeHealth()
        res.json(health)
    })

    app.get('/api/healthz', (_req: Request, res: Response) => {
        const health = ctx.getRuntimeHealth()
        res.status(health.status === 'critical' ? 503 : 200).json({
            status: health.status,
            pid: health.pid,
            uptimeSec: health.uptimeSec,
            cpuPercent: health.cpu.percent,
            rssBytes: health.memory.rss,
            connections: health.connections.total,
            mitmServers: health.mitmServers.count,
        })
    })
}
