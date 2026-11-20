import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../lambda/falas.js';
import { criarApi } from '../lambda/api.js';

const U = 'amzn1.ask.account.USUARIO-1234';
const falso = (impl = {}) => ({ list: async () => ({ items: [], speech: 'Sua lista está vazia.' }), add: async () => ({}), remove: async () => ({ found: true, name: 'leite' }), clear: async () => ({}), link: async () => ({ linked: true }), ...impl });
const erro = (status) => { const e = new Error('x'); e.status = status; return e; };

test('adicionar: confirma com a quantidade, usa 1 sem quantidade e pede o item quando não entendeu', async () => {
  const chamadas = [];
  const api = falso({ add: async (u, n, q) => { chamadas.push([u, n, q]); return {}; } });
  assert.equal((await F.adicionar({ api, userId: U, item: 'leite', quantidade: '2' })).fala, 'Pronto, adicionei 2 leite.');
  assert.equal((await F.adicionar({ api, userId: U, item: 'pão' })).fala, 'Pronto, adicionei pão.');
  assert.deepEqual(chamadas, [[U, 'leite', 2], [U, 'pão', 1]]);
  assert.match((await F.adicionar({ api, userId: U, item: '' })).fala, /Não entendi qual item/);
  assert.equal(chamadas.length, 2);
});

test('sem vínculo (409) pede para vincular; limite (429) e falha de rede viram frases, nunca erro', async () => {
  assert.equal((await F.adicionar({ api: falso({ add: async () => { throw erro(409); } }), userId: U, item: 'leite' })).fala, F.NAO_VINCULADO);
  assert.match((await F.ler({ api: falso({ list: async () => { throw erro(429); } }), userId: U })).fala, /Muitas tentativas/);
  assert.match((await F.ler({ api: falso({ list: async () => { throw new Error('rede'); } }), userId: U })).fala, /Não consegui falar/);
});

test('ler e iniciar', async () => {
  assert.equal((await F.ler({ api: falso({ list: async () => ({ speech: 'Sua lista tem 1 item: leite.' }) }), userId: U })).fala, 'Sua lista tem 1 item: leite.');
  assert.match((await F.iniciar({ api: falso({ list: async () => ({ items: [{}, {}] }) }), userId: U })).fala, /^Sua lista tem 2 itens\./);
  assert.match((await F.iniciar({ api: falso(), userId: U })).fala, /^Sua lista está vazia\./);
});

test('vincular: aceita 6 dígitos (com espaço), recusa o resto, trata código inválido', async () => {
  assert.equal(F.codigoFalado('482 913'), '482913');
  assert.equal(F.codigoFalado('48291'), null);
  assert.equal(F.codigoFalado(undefined), null);
  assert.match((await F.vincular({ api: falso(), userId: U, codigo: '482913' })).fala, /^Vinculado!/);
  assert.match((await F.vincular({ api: falso(), userId: U, codigo: '123' })).fala, /Não entendi o código/);
  assert.match((await F.vincular({ api: falso({ link: async () => { throw erro(404); } }), userId: U, codigo: '482913' })).fala, /não é válido ou já venceu/);
});

test('api: manda o segredo no cabeçalho, o id da Alexa no corpo e vira erro com status quando o Worker recusa', async () => {
  const vistos = [];
  const fetchFn = async (url, init) => { vistos.push([url, init.headers['x-skill-secret'], JSON.parse(init.body)]); return new Response(JSON.stringify(url.endsWith('/add') ? { error: 'não vinculado' } : { items: [] }), { status: url.endsWith('/add') ? 409 : 200 }); };
  const api = criarApi({ url: 'https://w.dev/', segredo: 'seg', fetchFn });
  await api.list(U);
  assert.deepEqual(vistos[0], ['https://w.dev/alexa/list', 'seg', { alexaUserId: U }]);
  await assert.rejects(api.add(U, 'leite', 2), (e) => e.status === 409);
  assert.deepEqual(vistos[1][2], { alexaUserId: U, name: 'leite', qty: 2 });
});
