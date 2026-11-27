import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, {type Request, type Response} from 'express';

const PORT = 3000;
const ROOT_DIR = process.cwd();

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_PASSWORD_SALT = 'hydropin_admin_salt_2026';
const DEFAULT_PASSWORD_HASH =
  'bd1705113fb79e7617c47ce842db400e83b5e929804bd57fb1f4de9400c783cdc1c2fe385706410230fb56c89dc6130e991b75dc0ee0724a63770a622d88c6bf';

const SESSION_SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  const aBuf = Buffer.from(aHex, 'hex');
  const bBuf = Buffer.from(bHex, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function timingSafeUtf8Equal(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyAdminPassword(candidate: string): boolean {
  if (ENV_ADMIN_PASSWORD.length > 0) {
    return timingSafeUtf8Equal(candidate, ENV_ADMIN_PASSWORD);
  }
  const derivedHex = crypto
    .scryptSync(candidate, DEFAULT_PASSWORD_SALT, 64)
    .toString('hex');
  return timingSafeHexEqual(derivedHex, DEFAULT_PASSWORD_HASH);
}

function signSessionToken(username: string): {token: string; expiresAt: number} {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({sub: username, role: 'admin', exp: expiresAt}),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  return {token: `${payload}.${sig}`, expiresAt};
}

function verifySessionToken(
  token: string
): {sub: string; role: string; exp: number} | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
  if (!timingSafeUtf8Equal(sig, expectedSig)) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as {sub?: string; role?: string; exp?: number};
    if (
      !decoded ||
      decoded.role !== 'admin' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.exp !== 'number' ||
      decoded.exp < Date.now()
    ) {
      return null;
    }
    return {sub: decoded.sub, role: decoded.role, exp: decoded.exp};
  } catch {
    return null;
  }
}

interface ServerLeakRecord {
  id: string;
  [key: string]: unknown;
}

interface RealtimeBroadcastPayload {
  action: 'upsert' | 'delete' | 'replace';
  version: number;
  leak?: ServerLeakRecord;
  id?: string;
  leaks?: ServerLeakRecord[];
  sourceClientId?: string;
  reason?: string;
  silent?: boolean;
  timestamp: string;
}

let serverLeaks: ServerLeakRecord[] = [];
let serverVersion = 0;
let serverUpdatedAt = new Date().toISOString();
const sseClients = new Set<Response>();

function broadcastLeakEvent(payload: RealtimeBroadcastPayload): void {
  const serialized = `event: leak_sync\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(serialized);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '15mb'}));

  app.get('/api/realtime/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(
      `event: connected\ndata: ${JSON.stringify({
        version: serverVersion,
        updatedAt: serverUpdatedAt,
      })}\n\n`
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.get('/api/leaks', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      version: serverVersion,
      updatedAt: serverUpdatedAt,
      leaks: serverLeaks,
    });
  });

  app.post('/api/leaks/mutate', (req: Request, res: Response) => {
    const body = req.body as {
      action?: unknown;
      leak?: unknown;
      id?: unknown;
      leaks?: unknown;
      sourceClientId?: unknown;
      reason?: unknown;
      silent?: unknown;
    };

    const action = typeof body?.action === 'string' ? body.action : '';
    const sourceClientId =
      typeof body?.sourceClientId === 'string'
        ? body.sourceClientId
        : undefined;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;
    const silent = body?.silent === true;

    if (action === 'seed_if_empty') {
      if (
        serverVersion === 0 &&
        Array.isArray(body?.leaks) &&
        body.leaks.length > 0
      ) {
        serverLeaks = body.leaks.filter(
          (item): item is ServerLeakRecord =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as ServerLeakRecord).id === 'string'
        );
        serverVersion = 1;
        serverUpdatedAt = new Date().toISOString();
        broadcastLeakEvent({
          action: 'replace',
          version: serverVersion,
          leaks: serverLeaks,
          sourceClientId,
          reason,
          silent: true,
          timestamp: serverUpdatedAt,
        });
      }
      res.json({ok: true, version: serverVersion});
      return;
    }

    if (action === 'upsert') {
      const leak = body?.leak as ServerLeakRecord | undefined;
      if (!leak || typeof leak !== 'object' || typeof leak.id !== 'string' || !leak.id.trim()) {
        res.status(400).json({ok: false, error: 'Invalid leak payload'});
        return;
      }

      const idx = serverLeaks.findIndex((item) => item.id === leak.id);
      if (idx >= 0) {
        serverLeaks = serverLeaks.map((item) =>
          item.id === leak.id ? leak : item
        );
      } else {
        serverLeaks = [leak, ...serverLeaks];
      }

      serverVersion += 1;
      serverUpdatedAt = new Date().toISOString();
      broadcastLeakEvent({
        action: 'upsert',
        version: serverVersion,
        leak,
        sourceClientId,
        reason,
        silent,
        timestamp: serverUpdatedAt,
      });
      res.json({ok: true, version: serverVersion});
      return;
    }

    if (action === 'delete') {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      const verified = token ? verifySessionToken(token) : null;
      if (!verified) {
        res.status(401).json({ok: false, error: 'Unauthorized delete'});
        return;
      }

      const id = typeof body?.id === 'string' ? body.id.trim() : '';
      if (!id) {
        res.status(400).json({ok: false, error: 'Invalid leak id'});
        return;
      }

      serverLeaks = serverLeaks.filter((item) => item.id !== id);
      serverVersion += 1;
      serverUpdatedAt = new Date().toISOString();
      broadcastLeakEvent({
        action: 'delete',
        version: serverVersion,
        id,
        sourceClientId,
        reason,
        silent,
        timestamp: serverUpdatedAt,
      });
      res.json({ok: true, version: serverVersion});
      return;
    }

    if (action === 'replace') {
      if (!Array.isArray(body?.leaks)) {
        res.status(400).json({ok: false, error: 'Invalid leaks list'});
        return;
      }
      serverLeaks = body.leaks.filter(
        (item): item is ServerLeakRecord =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as ServerLeakRecord).id === 'string'
      );
      serverVersion += 1;
      serverUpdatedAt = new Date().toISOString();
      broadcastLeakEvent({
        action: 'replace',
        version: serverVersion,
        leaks: serverLeaks,
        sourceClientId,
        reason,
        silent,
        timestamp: serverUpdatedAt,
      });
      res.json({ok: true, version: serverVersion});
      return;
    }

    res.status(400).json({ok: false, error: 'Unsupported action'});
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = req.body as {username?: unknown; password?: unknown};
    const username =
      typeof body?.username === 'string' ? body.username.trim() : '';
    const password =
      typeof body?.password === 'string' ? body.password : '';

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน',
      });
      return;
    }

    const userOk = timingSafeUtf8Equal(username, ADMIN_USERNAME);
    const passOk = verifyAdminPassword(password);
    if (!userOk || !passOk) {
      res.status(401).json({
        ok: false,
        error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
      });
      return;
    }

    const {token, expiresAt} = signSessionToken(username);
    res.json({
      ok: true,
      token,
      user: {username, role: 'admin'},
      expiresAt,
    });
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!token) {
      res.json({authenticated: false});
      return;
    }
    const verified = verifySessionToken(token);
    if (!verified) {
      res.status(401).json({authenticated: false});
      return;
    }
    res.json({
      authenticated: true,
      user: {username: verified.sub, role: verified.role},
    });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    res.json({ok: true});
  });

  if (process.env.NODE_ENV !== 'production') {
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.type('application/javascript; charset=utf-8').send(`
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
export class ErrorOverlay extends HTMLElement {
  close() { this.remove(); }
}
`);
    });

    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(ROOT_DIR, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not Found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
