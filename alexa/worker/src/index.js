import { tratar } from './handler.js';
export default { fetch: (req, env) => tratar(req, env).catch(() => new Response(JSON.stringify({ error: 'erro interno' }), { status: 500, headers: { 'content-type': 'application/json' } })) };
