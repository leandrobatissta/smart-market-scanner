// Teste de ponta a ponta com o SDK REAL da Alexa (cai fora se não rodou "npm install" em alexa/skill/lambda): pedidos no formato que a Alexa envia -> index.js -> falas -> Worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const temSdk = existsSync(new URL('../lambda/node_modules/ask-sdk-core', import.meta.url));
const SEG = 'segredo-de-teste-1234567';
const TOKEN = 'T'.repeat(43);
const USER = 'amzn1.ask.account.USUARIO-DE-TESTE-1234567890';

function envelope(request, atributos = {}) {
  const app = { applicationId: 'amzn1.ask.skill.teste' };
  return { version: '1.0', session: { new: true, sessionId: 'amzn1.echo-api.session.1', application: app, attributes: atributos, user: { userId: USER } },
    context: { System: { application: app, user: { userId: USER }, device: { deviceId: 'dev1', supportedInterfaces: {} }, apiEndpoint: 'https://api.amazonalexa.com' } },
    request: { requestId: 'r1', timestamp: new Date().toISOString(), locale: 'pt-BR', ...request } };
}
const intent = (name, slots = {}) => ({ type: 'IntentRequest', intent: { name, confirmationStatus: 'NONE', slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v, confirmationStatus: 'NONE' }])) } });
const fala = (r) => (r.response.outputSpeech?.ssml || '').replace(/<[^>]+>/g, '');

test('skill completa com o SDK da Alexa: abrir, vincular, adicionar e ler a lista', { skip: !temSdk && 'rode npm install em alexa/skill/lambda' }, async () => {
  const { tratar } = await import('../../worker/src/handler.js');
  const mem = new Map();
  const kv = { get: async (k) => (mem.has(k) ? mem.get(k) : null), put: async (k, v) => { mem.set(k, v); }, delete: async (k) => { mem.delete(k); } };
  const env = { LISTAS: kv, SKILL_SECRET: SEG, ALLOWED_ORIGIN: 'https://x.github.io' };
  process.env.LISTA_URL = 'https://worker.teste';
  process.env.SKILL_SECRET = SEG;
  globalThis.fetch = (url, init) => tratar(new Request(url, init), env);
  const { handler } = await import('../lambda/index.js');
  const chamar = (req, atributos) => new Promise((ok, erro) => handler(envelope(req, atributos), {}, (e, r) => (e ? erro(e) : ok(r))));

  assert.match(fala(await chamar({ type: 'LaunchRequest' })), /vincule esta Alexa ao site/);           // ainda sem vínculo
  assert.match(fala(await chamar(intent('AddItemIntent', { item: 'leite', quantidade: '2' }))), /vincule esta Alexa/);

  const pareamento = await tratar(new Request('https://worker.teste/pair/start', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } }), env);
  const { code } = await pareamento.json();
  assert.match(fala(await chamar(intent('LinkIntent', { codigo: '000000' }))), /não é válido ou já venceu/);
  assert.match(fala(await chamar(intent('LinkIntent', { codigo: code }))), /^Vinculado!/);

  assert.match(fala(await chamar({ type: 'LaunchRequest' })), /^Sua lista está vazia\./);
  assert.equal(fala(await chamar(intent('AddItemIntent', { item: 'leite', quantidade: '2' }))), 'Pronto, adicionei 2 leite.');
  assert.equal(fala(await chamar(intent('AddItemIntent', { item: 'pão' }))), 'Pronto, adicionei pão.');
  assert.equal(fala(await chamar(intent('AddItemIntent', { item: 'leite', quantidade: '1' }))), 'Pronto, adicionei leite.');   // soma na lista do site
  assert.equal(fala(await chamar(intent('ReadListIntent'))), 'Sua lista tem 2 itens: 3 leite e pão.');
  const lista = await (await tratar(new Request('https://worker.teste/list', { headers: { authorization: `Bearer ${TOKEN}` } }), env)).json();
  assert.deepEqual(lista.items.map((i) => [i.name, i.qty]), [['leite', 3], ['pão', 1]]);                // o que a Alexa pôs está na lista do site

  assert.match(fala(await chamar(intent('AMAZON.HelpIntent'))), /adicionar leite/);
  const fim = await chamar(intent('AMAZON.StopIntent'));
  assert.match(fala(fim), /Até logo/);
  assert.equal(fim.response.shouldEndSession, true);
  assert.match(fala(await chamar(intent('AMAZON.FallbackIntent'))), /Não entendi/);
});
