// Skill "mercado inteligente": liga as frases da Alexa às falas (falas.js) e ao Worker (api.js).
// Configuração da skill: LISTA_URL (endereço do Worker) e SKILL_SECRET (o mesmo segredo do Worker).
// Vêm das variáveis de ambiente OU de um arquivo config.js criado só no editor da Alexa (modelo em config.example.js; o config.js NÃO vai ao GitHub).
import * as Alexa from 'ask-sdk-core';
import { criarApi } from './api.js';
import * as F from './falas.js';

const cfg = await import('./config.js').catch(() => ({}));   // sem config.js, vale só o ambiente
const api = () => criarApi({ url: process.env.LISTA_URL || cfg.LISTA_URL, segredo: process.env.SKILL_SECRET || cfg.SKILL_SECRET });
const slot = (h, nome) => Alexa.getSlotValue(h.requestEnvelope, nome);
const uid = (h) => h.requestEnvelope.session.user.userId;
const responder = (h, r) => {
  let b = h.responseBuilder.speak(r.fala);
  if (r.reprompt) b = b.reprompt(r.reprompt);
  if (r.encerrar) b = b.withShouldEndSession(true);
  return b.getResponse();
};
const intent = (nome, fn) => ({
  canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && Alexa.getIntentName(h.requestEnvelope) === nome,
  handle: async (h) => responder(h, await fn(h)),
});

const handlers = [
  { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'LaunchRequest', handle: async (h) => responder(h, await F.iniciar({ api: api(), userId: uid(h) })) },
  intent('AddItemIntent', (h) => F.adicionar({ api: api(), userId: uid(h), item: slot(h, 'item'), quantidade: slot(h, 'quantidade') })),
  intent('ReadListIntent', (h) => F.ler({ api: api(), userId: uid(h) })),
  intent('LinkIntent', (h) => F.vincular({ api: api(), userId: uid(h), codigo: slot(h, 'codigo') })),
  intent('AMAZON.HelpIntent', () => F.ajuda()),
  { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'IntentRequest' && ['AMAZON.StopIntent', 'AMAZON.CancelIntent'].includes(Alexa.getIntentName(h.requestEnvelope)), handle: (h) => responder(h, F.encerrar()) },
  intent('AMAZON.FallbackIntent', () => F.naoEntendi()),
  { canHandle: (h) => Alexa.getRequestType(h.requestEnvelope) === 'SessionEndedRequest', handle: (h) => h.responseBuilder.getResponse() },
];

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(...handlers)
  .addErrorHandlers({ canHandle: () => true, handle: (h, e) => { console.error(e); return h.responseBuilder.speak('Desculpe, algo deu errado. Tente de novo.').getResponse(); } })
  .lambda();
