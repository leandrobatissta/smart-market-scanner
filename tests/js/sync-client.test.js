import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarCliente, enderecoValido, novoToken } from '../../docs/lib/sync-client.js';

test('novoToken: 43 caracteres base64url e sempre diferente', () => {
  const a = novoToken(), b = novoToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('enderecoValido: https ou localhost; vazio, http de fora e lixo desligam a sincronização', () => {
  assert.equal(enderecoValido({ syncUrl: 'https://lista.exemplo.workers.dev' }), 'https://lista.exemplo.workers.dev');
  assert.equal(enderecoValido({ syncUrl: 'http://localhost:8787' }), 'http://localhost:8787');
  for (const ruim of [{}, null, { syncUrl: '' }, { syncUrl: 'http://exemplo.com' }, { syncUrl: 'javascript:alert(1)' }, { syncUrl: 'https://a b.com' }]) assert.equal(enderecoValido(ruim), '');
});

test('cliente: manda o token, lê e grava a lista, gera código e trata recusa', async () => {
  const vistos = [];
  const fetchFn = async (url, init) => {
    vistos.push([init.method, url, init.headers.authorization, init.body ? JSON.parse(init.body) : null]);
    if (url.endsWith('/list') && init.method === 'GET') return new Response(JSON.stringify({ items: [{ name: 'leite', qty: 1, t: 1 }] }));
    if (url.endsWith('/list')) return new Response(JSON.stringify({ items: [{ name: 'arroz', qty: 2, t: 2 }] }));
    if (url.endsWith('/pair/start')) return new Response(JSON.stringify({ code: '123456' }), { status: 201 });
    if (url.endsWith('/pair/status')) return new Response(JSON.stringify({ linked: true }));
    return new Response(JSON.stringify({ error: 'token inválido' }), { status: 401 });
  };
  const c = criarCliente({ url: 'https://w.dev/', token: 'T'.repeat(43), fetchFn });
  assert.deepEqual(await c.pull(), [{ name: 'leite', qty: 1, t: 1 }]);
  assert.deepEqual(await c.push([{ name: 'arroz', qty: 2, t: 2 }]), [{ name: 'arroz', qty: 2, t: 2 }]);
  assert.equal((await c.pairStart()).code, '123456');
  assert.equal(await c.pairStatus(), true);
  assert.deepEqual(vistos[0].slice(0, 3), ['GET', 'https://w.dev/list', 'Bearer ' + 'T'.repeat(43)]);
  assert.deepEqual(vistos[1][3], { items: [{ name: 'arroz', qty: 2, t: 2 }] });
  const ruim = criarCliente({ url: 'https://w.dev', token: 'x', fetchFn: async () => new Response(JSON.stringify({ error: 'token inválido' }), { status: 401 }) });
  await assert.rejects(ruim.pull(), (e) => e.status === 401);
});
