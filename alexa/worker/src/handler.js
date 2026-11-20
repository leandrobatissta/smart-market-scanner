// Regras do serviço da lista, sem depender do Cloudflare (recebe o armazenamento `kv`): assim dá para testar com um KV de mentira.
import { MAX_ITENS, adicionar, ativos, codigo6, falaDaLista, limpar, mesclar, remover } from '../../../docs/lib/lista-sync.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/** Comparação sem parar na primeira diferença (para o segredo da skill). */
export function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (corpo, status = 200, extra = {}) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

function cors(req, env) {
  const origem = req.headers.get('origin') || '';
  const ok = [env.ALLOWED_ORIGIN, 'http://localhost:8080', 'http://127.0.0.1:8080'].filter(Boolean);
  return ok.includes(origem) ? { 'access-control-allow-origin': origem, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', vary: 'origin' } : {};
}

async function lerLista(env, conta) { return JSON.parse((await env.LISTAS.get(`lista:${conta}`)) || '[]'); }
async function gravarLista(env, conta, itens) { await env.LISTAS.put(`lista:${conta}`, JSON.stringify(itens.slice(0, MAX_ITENS * 2))); }

/** Conta do site: o hash do token que o navegador gerou (o token em si nunca é guardado). */
async function contaDoSite(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.get('authorization') || '');
  return m ? sha256(m[1]) : null;
}

export async function tratar(req, env) {
  const url = new URL(req.url);
  const c = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
  const resp = (corpo, status) => json(corpo, status, c);
  const rota = `${req.method} ${url.pathname}`;
  const corpo = async () => { try { const t = await req.text(); if (t.length > 65536) return null; return JSON.parse(t || '{}'); } catch { return null; } };

  // ---------- site (token do navegador)
  if (rota === 'GET /list' || rota === 'PUT /list' || rota === 'POST /pair/start' || rota === 'GET /pair/status') {
    const conta = await contaDoSite(req);
    if (!conta) return resp({ error: 'token inválido' }, 401);
    if (rota === 'GET /list') return resp({ items: await lerLista(env, conta) });
    if (rota === 'PUT /list') {
      const b = await corpo();
      if (!b || !Array.isArray(b.items) || b.items.length > MAX_ITENS * 2) return resp({ error: 'lista inválida' }, 400);
      const juntos = mesclar(await lerLista(env, conta), b.items);
      await gravarLista(env, conta, juntos);
      return resp({ items: juntos });
    }
    if (rota === 'POST /pair/start') {
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      const codigo = codigo6(bytes);
      await env.LISTAS.put(`pair:${codigo}`, conta, { expirationTtl: 600 });
      return resp({ code: codigo, expiresInSeconds: 600 }, 201);
    }
    const ligada = await env.LISTAS.get(`conta-alexa:${conta}`);
    return resp({ linked: !!ligada });
  }

  // ---------- skill da Alexa (segredo compartilhado + id do usuário da Alexa)
  if (url.pathname.startsWith('/alexa/')) {
    if (!env.SKILL_SECRET || !iguais(req.headers.get('x-skill-secret') || '', env.SKILL_SECRET)) return resp({ error: 'não autorizado' }, 401);
    const b = await corpo();
    const uid = b && typeof b.alexaUserId === 'string' && b.alexaUserId.length >= 8 && b.alexaUserId.length <= 300 ? b.alexaUserId : null;
    if (!uid) return resp({ error: 'alexaUserId ausente' }, 400);
    const ukey = await sha256(uid);

    if (rota === 'POST /alexa/link') {
      const tentativas = Number((await env.LISTAS.get(`tent:${ukey}`)) || 0);
      if (tentativas >= 5) return resp({ error: 'muitas tentativas, espere alguns minutos' }, 429);
      const conta = await env.LISTAS.get(`pair:${String(b.code || '')}`);
      if (!conta) { await env.LISTAS.put(`tent:${ukey}`, String(tentativas + 1), { expirationTtl: 600 }); return resp({ error: 'código inválido ou vencido' }, 404); }
      await env.LISTAS.put(`alexa:${ukey}`, conta);
      await env.LISTAS.put(`conta-alexa:${conta}`, '1');
      await env.LISTAS.delete(`pair:${b.code}`);
      return resp({ linked: true });
    }
    const conta = await env.LISTAS.get(`alexa:${ukey}`);
    if (!conta) return resp({ linked: false, error: 'não vinculado' }, 409);
    const itens = await lerLista(env, conta);
    if (rota === 'POST /alexa/list') return resp({ linked: true, items: ativos(itens), speech: falaDaLista(itens) });
    if (rota === 'POST /alexa/add') {
      if (typeof b.name !== 'string' || !b.name.trim()) return resp({ error: 'item ausente' }, 400);
      const novos = adicionar(itens, b.name, b.qty ?? 1);
      await gravarLista(env, conta, novos);
      return resp({ linked: true, items: ativos(novos) });
    }
    if (rota === 'POST /alexa/remove') {
      const r = remover(itens, String(b.name || ''));
      if (r.achou) await gravarLista(env, conta, r.itens);
      return resp({ linked: true, found: r.achou, name: r.nome || null, items: ativos(r.itens) });
    }
    if (rota === 'POST /alexa/clear') { const novos = limpar(itens); await gravarLista(env, conta, novos); return resp({ linked: true, items: [] }); }
  }
  return resp({ error: 'não encontrado' }, 404);
}
