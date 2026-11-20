// Servidor local do Worker (para testar sem Cloudflare): node alexa/worker/dev-server.mjs   -> http://localhost:8787
// O armazenamento é em memória (some ao parar). O segredo da skill vem de SKILL_SECRET (padrão "dev-secret").
import { createServer } from 'node:http';
import { tratar } from './src/handler.js';

const mem = new Map();
const kv = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); } };
const env = { LISTAS: kv, SKILL_SECRET: process.env.SKILL_SECRET || 'dev-secret', ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:8080' };

createServer(async (req, res) => {
  const partes = [];
  for await (const p of req) partes.push(p);
  const corpo = Buffer.concat(partes);
  const r = await tratar(new Request(`http://localhost:8787${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) || !corpo.length ? undefined : corpo }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('Worker local em http://localhost:8787'));
