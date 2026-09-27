// Nocap daemon (localhost:7777). Owner: Role B, except src/adapters/ (Role A).
// Role B owns the local API and streams; agent-specific request mapping stays in adapters/.

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { BUILD_ID, DAEMON_HOST, DAEMON_PORT, detectProvider, loadEnv } from '@nocap/shared';
import { checkKey } from '@nocap/judge';
import type { CheckRequest, HealthResponse, HumanIntentRequest, TaskRequest } from '@nocap/shared';
import { bus } from './bus';
import { runCheck } from './pipeline';
import { pendingHumanChecks, submitHumanIntent } from './humanCheck';
import { sessions } from './sessions';
import { registerClaudeRoutes } from './adapters/claude';
import { registerShimRoutes } from './adapters/shim';
import { registerCodexRoutes } from './adapters/codex';
import { registerGeminiRoutes } from './adapters/gemini';
import { registerAntigravityRoutes } from './adapters/antigravity';
import { registerVsCodeRoutes } from './adapters/vscode';
import { registerCursorRoutes } from './adapters/cursor';

// The daemon runs with cwd = the user's project, so look there first, then next to the daemon itself
// (finds the repo's .env in dev). TODO(A): installed users should set the key via VS Code SecretStorage.
loadEnv();
loadEnv(__dirname);

export async function startServer(port = DAEMON_PORT) {
  const app = Fastify({ logger: false });
  await app.register(formbody);
  await app.register(websocket);

  app.get('/v1/health', async (): Promise<HealthResponse> => ({ ok: true, version: '0.1.0', build: BUILD_ID }));

  // Lets a newer extension build replace a daemon left over from an older one (localhost only).
  app.post('/v1/shutdown', async () => {
    setTimeout(() => process.exit(0), 50);
    return { ok: true };
  });

  app.post<{ Body: CheckRequest }>('/v1/check', async (req) => runCheck(req.body));

  // Recent checks, tasks and pop-up outcomes, so the panel can rebuild itself after a reload.
  app.get('/v1/recent', async () => bus.recent());

  app.post<{ Body: TaskRequest }>('/v1/task', async (req) => {
    sessions.setTask(req.body.session_id, req.body.task, req.body.source, req.body.workspace);
    return { ok: true };
  });

  app.post<{ Body: HumanIntentRequest }>('/v1/human-intent', async (req) => submitHumanIntent(req.body));

  // The extension hands over the judge's API key from VS Code SecretStorage (localhost only; never written to disk).
  // Any provider (shared/providers.ts); the judge reads it on its next call. `gemini_api_key` is the old field name.
  app.post<{ Body: { api_key?: string; gemini_api_key?: string } }>('/v1/key', async (req) => {
    const key = (req.body?.api_key ?? req.body?.gemini_api_key)?.trim();
    if (!key) return { ok: false };
    process.env.NOCAP_API_KEY = key;
    return { ok: true, provider: detectProvider(key)?.name ?? null };
  });

  // Checks a key with its provider before the extension saves it.
  app.post<{ Body: { api_key?: string } }>('/v1/key/check', async (req) => checkKey(req.body?.api_key?.trim() ?? ''));

  // `?roots=` (JSON array): the window's workspace folders, so pop-ups reach the window for that workspace.
  app.get<{ Querystring: { roots?: string } }>('/v1/stream', { websocket: true }, (socket, req) => {
    const off = bus.subscribe((event) => socket.send(JSON.stringify(event)), parseRoots(req.query.roots));
    socket.on('close', off);
    // A window that connects late still gets the pop-ups that are waiting (the extension ignores ones it already shows).
    for (const event of pendingHumanChecks()) socket.send(JSON.stringify(event));
  });

  registerClaudeRoutes(app);
  registerShimRoutes(app);
  registerCodexRoutes(app);
  registerGeminiRoutes(app);
  registerAntigravityRoutes(app);
  registerVsCodeRoutes(app);
  registerCursorRoutes(app);

  await app.listen({ host: DAEMON_HOST, port });
  console.log(`Nocap daemon listening on http://${DAEMON_HOST}:${port}`);
  return app;
}

function parseRoots(raw: string | undefined): string[] {
  try {
    const roots = JSON.parse(raw ?? '[]');
    return Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
