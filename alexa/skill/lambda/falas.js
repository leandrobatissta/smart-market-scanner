// Tudo o que a skill responde, sem depender do SDK da Alexa: recebe `api` (cliente do Worker) e devolve { fala, reprompt?, encerrar?, atributos? }.
// Fica separado do index.js para dar para testar sem a Alexa.

const AJUDA = 'Você pode dizer: adicionar leite, ou: o que tem na minha lista. Para ligar ao site, diga: vincular código, e os seis números que aparecem no site.';
export const NAO_VINCULADO = 'Primeiro vincule esta Alexa ao site. No site, abra Minha lista, toque em Conectar Alexa e anote o código de seis números. Depois diga: vincular código, e os seis números.';

const plural = (n, um, varios) => (n === 1 ? um : varios);
const limpo = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);

/** Dígitos do código falado ("quatro oito dois..." ou "482913" ou "482 913"): vira 6 dígitos ou null. */
export function codigoFalado(valor) {
  const d = String(valor || '').replace(/\D/g, '');
  return /^\d{6}$/.test(d) ? d : null;
}

/** Trata um erro do Worker numa fala em vez de deixar a skill quebrar. */
function falhou(e) {
  if (e && e.status === 409) return { fala: NAO_VINCULADO };
  if (e && e.status === 429) return { fala: 'Muitas tentativas. Espere alguns minutos e tente de novo.' };
  return { fala: 'Não consegui falar com a sua lista agora. Tente de novo em instantes.' };
}

export async function iniciar({ api, userId }) {
  try {
    const r = await api.list(userId);
    const n = (r.items || []).length;
    return { fala: `${n ? `Sua lista tem ${n} ${plural(n, 'item', 'itens')}. ` : 'Sua lista está vazia. '}Diga, por exemplo: adicionar leite.`, reprompt: AJUDA };
  } catch (e) { return falhou(e); }
}

export async function adicionar({ api, userId, item, quantidade }) {
  const nome = limpo(item);
  if (!nome) return { fala: 'Não entendi qual item. Diga, por exemplo: adicionar leite.', reprompt: 'Qual item você quer adicionar?' };
  const qtd = Math.max(1, Math.min(99, Math.round(Number(quantidade) || 1)));
  try {
    await api.add(userId, nome, qtd);
    return { fala: `Pronto, adicionei ${qtd > 1 ? `${qtd} ` : ''}${nome}.`, reprompt: 'Quer adicionar mais alguma coisa?' };
  } catch (e) { return falhou(e); }
}

export async function ler({ api, userId }) {
  try { const r = await api.list(userId); return { fala: r.speech || 'Sua lista está vazia.' }; } catch (e) { return falhou(e); }
}

export async function vincular({ api, userId, codigo }) {
  const c = codigoFalado(codigo);
  if (!c) return { fala: 'Não entendi o código. Diga: vincular código, e os seis números que aparecem no site.', reprompt: 'Qual é o código de seis números?' };
  try {
    await api.link(userId, c);
    return { fala: 'Vinculado! Agora o que você pedir aparece no site, e o que está no site você pode ouvir aqui. Diga: adicionar leite.' };
  } catch (e) {
    if (e && e.status === 404) return { fala: 'Esse código não é válido ou já venceu. Gere um novo no site e tente de novo.' };
    return falhou(e);
  }
}

export const ajuda = () => ({ fala: AJUDA, reprompt: AJUDA });
export const encerrar = () => ({ fala: 'Até logo!', encerrar: true });
export const naoEntendi = () => ({ fala: 'Não entendi. ' + AJUDA, reprompt: AJUDA });
