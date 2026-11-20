import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tratar, iguais } from '../src/handler.js';

class KV { constructor() { this.m = new Map(); } async get(k) { return this.m.has(k) ? this.m.get(k) : null; } async put(k, v) { this.m.set(k, v); } async delete(k) { this.m.delete(k); } }
const env = () => ({ LISTAS: new KV(), SKILL_SECRET: 'segredo-da-skill-123', ALLOWED_ORIGIN: 'https://x.github.io' });
const TOKEN = 'a'.repeat(40);
const site = (e, metodo, caminho, corpo, token = TOKEN) => tratar(new Request('https://w.dev' + caminho, { method: metodo, headers: { authorization: `Bearer ${token}`, origin: 'https://x.github.io', 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined }), e);
const alexa = (e, caminho, corpo, segredo = 'segredo-da-skill-123') => tratar(new Request('https://w.dev' + caminho, { method: 'POST', headers: { 'x-skill-secret': segredo, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }), e);
const UID = 'amzn1.ask.account.USUARIO-DA-ALEXA-1234';

test('iguais: comparação de segredo', () => { assert.ok(iguais('abc', 'abc')); assert.ok(!iguais('abc', 'abd')); assert.ok(!iguais('abc', undefined)); });

test('site: sem token ou token curto é recusado; com token lê e grava a lista (mesclando)', async () => {
  const e = env();
  assert.equal((await tratar(new Request('https://w.dev/list'), e)).status, 401);
  assert.equal((await site(e, 'GET', '/list', null, 'curto')).status, 401);
  assert.deepEqual((await (await site(e, 'GET', '/list')).json()).items, []);
  const r = await site(e, 'PUT', '/list', { items: [{ name: 'leite', qty: 2, t: 10 }] });
  assert.equal(r.status, 200);
  const r2 = await (await site(e, 'PUT', '/list', { items: [{ name: 'LEITE', qty: 3, t: 5 }, { name: 'pão', qty: 1, t: 6 }] })).json();
  assert.deepEqual(r2.items.map((i) => [i.name, i.qty]), [['leite', 2], ['pão', 1]]);   // o t mais novo (10) ganhou
  assert.equal((await site(e, 'PUT', '/list', { items: 'x' })).status, 400);
});

test('contas separadas: o token de um não enxerga a lista do outro', async () => {
  const e = env();
  await site(e, 'PUT', '/list', { items: [{ name: 'leite', qty: 1, t: 1 }] });
  assert.deepEqual((await (await site(e, 'GET', '/list', null, 'b'.repeat(40))).json()).items, []);
});

test('pareamento: o site gera o código, a Alexa vincula, o código vale uma vez e erra no máximo 5 vezes', async () => {
  const e = env();
  const { code } = await (await site(e, 'POST', '/pair/start')).json();
  assert.match(code, /^\d{6}$/);
  assert.equal((await alexa(e, '/alexa/link', { alexaUserId: UID, code: '000000' })).status, 404);
  assert.equal((await alexa(e, '/alexa/link', { alexaUserId: UID, code })).status, 200);
  assert.equal((await alexa(e, '/alexa/link', { alexaUserId: UID, code })).status, 404);           // já usado
  assert.equal((await (await site(e, 'GET', '/pair/status')).json()).linked, true);
  const e2 = env();
  for (let i = 0; i < 5; i++) await alexa(e2, '/alexa/link', { alexaUserId: UID, code: '111111' });
  assert.equal((await alexa(e2, '/alexa/link', { alexaUserId: UID, code: '111111' })).status, 429);
});

test('Alexa: segredo errado é recusado; sem vínculo pede para vincular; depois adiciona, lê, remove e limpa na lista do site', async () => {
  const e = env();
  assert.equal((await alexa(e, '/alexa/add', { alexaUserId: UID, name: 'leite' }, 'errado')).status, 401);
  assert.equal((await alexa(e, '/alexa/add', { alexaUserId: UID, name: 'leite' })).status, 409);
  const { code } = await (await site(e, 'POST', '/pair/start')).json();
  await alexa(e, '/alexa/link', { alexaUserId: UID, code });
  await alexa(e, '/alexa/add', { alexaUserId: UID, name: 'Café', qty: 2 });
  await alexa(e, '/alexa/add', { alexaUserId: UID, name: 'cafe', qty: 1 });
  const lida = await (await alexa(e, '/alexa/list', { alexaUserId: UID })).json();
  assert.equal(lida.speech, 'Sua lista tem 1 item: 3 Café.');
  assert.deepEqual((await (await site(e, 'GET', '/list')).json()).items.map((i) => [i.name, i.qty]), [['Café', 3]]);   // o que a Alexa pôs aparece no site
  const rem = await (await alexa(e, '/alexa/remove', { alexaUserId: UID, name: 'café' })).json();
  assert.equal(rem.found, true);
  assert.equal((await (await alexa(e, '/alexa/remove', { alexaUserId: UID, name: 'sabonete' })).json()).found, false);
  await alexa(e, '/alexa/add', { alexaUserId: UID, name: 'ovos' });
  await alexa(e, '/alexa/clear', { alexaUserId: UID });
  assert.deepEqual((await (await alexa(e, '/alexa/list', { alexaUserId: UID })).json()).items, []);
});

test('CORS: só as origens permitidas; OPTIONS responde; rota desconhecida é 404', async () => {
  const e = env();
  const ok = await tratar(new Request('https://w.dev/list', { method: 'OPTIONS', headers: { origin: 'https://x.github.io' } }), e);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://x.github.io');
  const mau = await tratar(new Request('https://w.dev/list', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), e);
  assert.equal(mau.headers.get('access-control-allow-origin'), null);
  assert.equal((await site(e, 'GET', '/nada')).status, 404);
});
