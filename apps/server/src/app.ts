import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config';
import { createDb, migrate, type Db } from './db';
import { attachUser, authRoutes, type Mailer } from './auth';
import { docRoutes, shareRoutes } from './docs';
import { aiRoutes } from './ai';
import { SyncServer } from './sync';
import { csrf, rateLimit, securityHeaders } from './security';

export interface DeckServer {
  app: express.Express;
  server: Server;
  db: Db;
  sync: SyncServer;
  close: () => Promise<void>;
}

export function consoleMailer(production: boolean, webhook: string | null): Mailer {
  return {
    async send(to, subject, text) {
      if (webhook) {
        // Operator-configured mail relay (e.g. a transactional email service's HTTP endpoint).
        const r = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, subject, text }) });
        if (!r.ok) console.error('[mail] relay failed', r.status);
        return;
      }
      if (production) console.warn('[mail] DECK_MAIL_WEBHOOK is not set; email to', to.replace(/(.).*@/, '$1***@'), 'was not sent');
      else console.log(`[mail:dev] to=${to}\nsubject=${subject}\n${text}`);
    },
  };
}

export async function createDeckServer(cfg: Config, opts: { mailer?: Mailer } = {}): Promise<DeckServer> {
  const db = createDb(cfg.databaseUrl);
  await migrate(db);
  const sync = new SyncServer(db, cfg);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.production ? 1 : false);
  app.use(securityHeaders(cfg.production));
  app.use('/api', express.json({ limit: '280mb' }));
  app.use('/api', rateLimit({ name: 'api', windowMs: 60_000, max: cfg.limits.apiPerMinute }));
  app.use('/api', csrf(cfg.allowedOrigins));
  app.use('/api', attachUser(db));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const mailer = opts.mailer ?? consoleMailer(cfg.production, cfg.mailWebhook);
  app.use('/api/auth', rateLimit({ name: 'auth', windowMs: 60_000, max: cfg.limits.authPerMinute }), authRoutes(db, cfg, mailer, (uid) => void sync.recheckUser(uid)));
  app.use('/api/docs', docRoutes(db, cfg, sync));
  app.use('/api/share', shareRoutes(db, sync));
  app.use('/api/ai', aiRoutes(db, cfg));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (cfg.staticDir && existsSync(cfg.staticDir)) {
    app.use(express.static(cfg.staticDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => p.includes('/assets/') && res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(cfg.staticDir!, 'index.html')));
  }

  // Never leak stack traces.
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error('[error]', err.message);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Something went wrong' });
  });

  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => void sync.handleUpgrade(req, socket, head));
  return {
    app,
    server,
    db,
    sync,
    close: async () => {
      await sync.close();
      await new Promise<void>((r) => server.close(() => r()));
      await db.end();
    },
  };
}
