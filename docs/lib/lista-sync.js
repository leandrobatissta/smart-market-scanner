// Lista de compras sincronizável (site, Alexa e Worker usam ESTA lógica). Cada item: { name, qty, t, del? }
// t = quando mudou (ms); del = apagado (tombstone, para a exclusão chegar aos outros). Vale o mais recente por item (nome sem acento, minúsculo).
import { stripAccents } from './normalize.js';

export const MAX_ITENS = 300;
const TOMBSTONE_MS = 30 * 24 * 3600 * 1000;

export const chave = (nome) => stripAccents(String(nome)).toLowerCase().replace(/\s+/g, ' ').trim();
export const limpaNome = (nome) => String(nome).replace(/\s+/g, ' ').trim().slice(0, 80);
export const limpaQtd = (q) => Math.max(1, Math.min(999, Math.round(Number(q) || 1)));

/** Une duas listas: por item vale o `t` mais novo; empate fica o apagado. Tombstones velhos saem. Ordem: a de `a` e depois os novos de `b`. */
export function mesclar(a, b, agora = Date.now()) {
  const mapa = new Map();
  for (const lista of [a || [], b || []]) {
    for (const it of lista) {
      if (!it || typeof it.name !== 'string' || !limpaNome(it.name)) continue;
      const k = chave(it.name);
      const novo = { name: limpaNome(it.name), qty: limpaQtd(it.qty), t: Number(it.t) || 0, ...(it.del ? { del: true } : {}) };
      const atual = mapa.get(k);
      if (!atual || novo.t > atual.t || (novo.t === atual.t && novo.del && !atual.del)) mapa.set(k, novo);
    }
  }
  return [...mapa.values()].filter((i) => !(i.del && agora - i.t > TOMBSTONE_MS)).slice(0, MAX_ITENS * 2);
}

export const ativos = (itens) => (itens || []).filter((i) => !i.del);

/** Soma a quantidade se o item já está na lista; senão cria. */
export function adicionar(itens, nome, qtd, agora = Date.now()) {
  const n = limpaNome(nome);
  if (!n) return itens;
  const k = chave(n);
  const atual = (itens || []).find((i) => chave(i.name) === k && !i.del);
  if (atual) return mesclar(itens, [{ name: atual.name, qty: limpaQtd(atual.qty + limpaQtd(qtd)), t: Math.max(agora, atual.t + 1) }], agora);   // sempre mais novo que o anterior, mesmo no mesmo milissegundo
  const apagado = (itens || []).find((i) => chave(i.name) === k && i.del);   // voltando depois de apagado: tem de ser mais novo que o tombstone
  return mesclar(itens, [{ name: n, qty: limpaQtd(qtd), t: apagado ? Math.max(agora, apagado.t + 1) : agora }], agora);
}

/** Apaga um item (tombstone). Devolve a lista e se achou. */
export function remover(itens, nome, agora = Date.now()) {
  const k = chave(nome);
  const achou = (itens || []).find((i) => !i.del && (chave(i.name) === k || chave(i.name).includes(k) && k.length >= 3));
  if (!achou) return { itens, achou: false };
  return { itens: mesclar(itens, [{ name: achou.name, qty: achou.qty, t: Math.max(agora, achou.t + 1), del: true }], agora), achou: true, nome: achou.name };
}

export const limpar = (itens, agora = Date.now()) => mesclar(itens, ativos(itens).map((i) => ({ name: i.name, qty: i.qty, t: Math.max(agora, i.t + 1), del: true })), agora);

/**
 * Compara a lista antes e depois de uma edição local e devolve a lista com `t` nos itens novos ou alterados e tombstones dos removidos.
 * `antes` e `depois` no formato do site: [{ name, qty }] (a lista guardada traz `t`; aqui só se calcula o que mudou).
 */
export function reconciliar(guardada, depois, agora = Date.now()) {
  const old = new Map((guardada || []).filter((i) => !i.del).map((i) => [chave(i.name), i]));
  const out = [...(guardada || [])];
  const novos = [];
  const keys = new Set();
  for (const it of depois || []) {
    const k = chave(it.name); keys.add(k);
    const o = old.get(k);
    if (!o || o.qty !== limpaQtd(it.qty)) novos.push({ name: limpaNome(it.name), qty: limpaQtd(it.qty), t: agora });
  }
  for (const [k, o] of old) if (!keys.has(k)) novos.push({ name: o.name, qty: o.qty, t: agora, del: true });
  return mesclar(out, novos, agora);
}

/** Código de pareamento de 6 dígitos a partir de bytes aleatórios. */
export function codigo6(bytes) {
  let n = 0;
  for (const b of bytes) n = (n * 256 + b) % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Fala natural da lista para a Alexa. */
export function falaDaLista(itens) {
  const l = ativos(itens);
  if (!l.length) return 'Sua lista está vazia.';
  const partes = l.slice(0, 20).map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name));
  const resto = l.length > 20 ? ` e mais ${l.length - 20} itens` : '';
  const juntar = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
  return `Sua lista tem ${l.length} ${l.length === 1 ? 'item' : 'itens'}: ${juntar}${resto}.`;
}
