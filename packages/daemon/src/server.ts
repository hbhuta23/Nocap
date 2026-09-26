// nocap daemon (localhost:7777). Owner: Role B, except src/adapters/ (Role A).
// Role B owns the local API and streams; agent-specific request mapping stays in adapters/.

import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { DAEMON_HOST, DAEMON_PORT, loadEnv } from '@nocap/shared';
import type { CheckRequest, HealthResponse, HumanIntentRequest, TaskRequest } from '@nocap/shared';
import { bus } from './bus';
import { runCheck } from './pipeline';
import { submitHumanIntent } from './humanCheck';
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

  app.get('/v1/health', async (): Promise<HealthResponse> => ({ ok: true, version: '0.0.1' }));

  app.post<{ Body: CheckRequest }>('/v1/check', async (req) => runCheck(req.body));

  app.post<{ Body: TaskRequest }>('/v1/task', async (req) => {
    sessions.setTask(req.body.session_id, req.body.task, req.body.source);
    return { ok: true };
  });

  app.post<{ Body: HumanIntentRequest }>('/v1/human-intent', async (req) => submitHumanIntent(req.body));

  app.get('/v1/stream', { websocket: true }, (socket) => {
    const off = bus.subscribe((event) => socket.send(JSON.stringify(event)));
    socket.on('close', off);
  });

  registerClaudeRoutes(app);
  registerShimRoutes(app);
  registerCodexRoutes(app);
  registerGeminiRoutes(app);
  registerAntigravityRoutes(app);
  registerVsCodeRoutes(app);
  registerCursorRoutes(app);

  await app.listen({ host: DAEMON_HOST, port });
  console.log(`nocap daemon listening on http://${DAEMON_HOST}:${port}`);
  return app;
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
