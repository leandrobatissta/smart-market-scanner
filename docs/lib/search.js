// Busca inteligente sobre a BASE DE ITENS (itens básicos por categoria) e sobre os produtos coletados: sem acento, com erro de digitação,
// prefixo ("arr" acha arroz) e sinônimos ("refri", "pasta de dente", "sabão em pó"). Funções puras.
import { tokens, stripAccents } from './normalize.js';

/** Frases equivalentes (já sem acento, minúsculas). A busca tenta a frase original e cada equivalente. */
export const SINONIMOS = [
  ['refri', 'refrigerante'], ['pasta de dente', 'creme dental'], ['pasta dental', 'creme dental'], ['sabao em po', 'sabao po'], ['sabao em po', 'lava roupas'],
  ['sabao po', 'sabao em po'], ['miojo', 'macarrao instantaneo'], ['nescau', 'achocolatado'], ['toddy', 'achocolatado'], ['guarana', 'refrigerante guarana'],
  ['coca', 'refrigerante cola'], ['papel toalha', 'papel toalha'], ['absorvente', 'absorvente'], ['bolacha', 'biscoito'], ['pao frances', 'pao'],
  ['frango', 'peito de frango'], ['carne', 'carne moida'], ['mandioca', 'aipim'], ['aipim', 'mandioca'], ['mussarela', 'queijo mussarela'], ['muçarela', 'queijo mussarela'],
  ['oleo', 'oleo de soja'], ['acucar', 'acucar refinado'], ['cafe', 'cafe 500g'], ['feijao', 'feijao carioca'], ['agua', 'agua mineral'],
];

export function variantes(query) {
  const base = stripAccents(String(query).toLowerCase()).replace(/\s+/g, ' ').trim();
  const out = new Set([base]);
  for (const [a, b] of SINONIMOS) {
    if (base === a || base.startsWith(a + ' ') || base.endsWith(' ' + a) || base.includes(' ' + a + ' ')) out.add(base.replace(a, b));
  }
  return [...out].filter(Boolean);
}

/** Distância de edição com corte (devolve max+1 se passar do limite). */
export function distancia(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let min = i;
    for (let j = 1; j <= b.length; j++) {
      const c = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(c); if (c < min) min = c;
    }
    if (min > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Nota (0 a 1) de uma palavra da busca contra as palavras de uma entrada. */
function notaPalavra(q, entradaTokens, fuzzy = true) {
  let best = 0;
  for (const t of entradaTokens) {
    if (t === q) return 1;
    if (q.length >= 2 && t.startsWith(q)) best = Math.max(best, 0.9);
    else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 0.6);
    else if (fuzzy && q.length >= 4 && t.length >= 4) {
      const lim = q.length >= 7 ? 2 : 1;
      if (distancia(q, t, lim) <= lim) best = Math.max(best, 0.7);
      else if (q.length >= 5 && t.length > q.length && distancia(q, t.slice(0, q.length), 1) <= 1) best = Math.max(best, 0.65); // erro de digitação em prefixo
    }
  }
  return best;
}

/** Nota da busca contra uma entrada preparada ({ _t: tokens }); 0 se alguma palavra da busca não casa. */
export function nota(queryTokens, entrada, fuzzy = true) {
  if (!queryTokens.length) return 0;
  let soma = 0;
  for (const q of queryTokens) { const n = notaPalavra(q, entrada._t, fuzzy); if (n === 0) return 0; soma += n; }
  return soma / queryTokens.length;
}

/** Prepara a base de itens ([{ term, category, n, min, stores }]) e os produtos para a busca. */
export function prepararBase(itens, produtos) {
  return {
    itens: (itens || []).map((i) => ({ ...i, kind: 'item', label: i.term, _t: tokens(i.term) })),
    produtos: (produtos || []).map((p) => ({ kind: 'produto', label: p.name, product: p, _t: tokens(`${p.name} ${p.brand || ''}`) })),
  };
}

/** Sugestões para o que a pessoa digita: itens da base primeiro (genéricos) e depois produtos específicos; ordenadas por nota, popularidade e tamanho. */
export function sugerir(base, query, limite = 8) {
  const vs = variantes(query);
  if (!vs.length || vs[0].length < 2) return [];
  const achados = new Map();
  for (const v of vs) {
    const qt = tokens(v);
    for (const e of base.itens) {
      const s = nota(qt, e);
      if (s > 0) { const k = 'i:' + e.term; if (!achados.has(k) || achados.get(k).s < s) achados.set(k, { e, s: s + 0.15, via: v }); }
    }
    for (const e of base.produtos) {
      const s = nota(qt, e);
      if (s >= 0.6) { const k = 'p:' + e.product.id; if (!achados.has(k) || achados.get(k).s < s) achados.set(k, { e, s, via: v }); }
    }
  }
  return [...achados.values()]
    .sort((a, b) => b.s - a.s || (b.e.n || 0) - (a.e.n || 0) || a.e.label.length - b.e.label.length)
    .slice(0, limite)
    .map(({ e }) => (e.kind === 'item'
      ? { kind: 'item', label: e.label, add: e.label, category: e.category, n: e.n, min: e.min, stores: e.stores }
      : { kind: 'produto', label: e.label, add: e.label, category: e.product.category, store: e.product.store, price: e.product.price }));
}

/** Base de itens derivada da coleta: um item por termo buscado (com categoria, quantos produtos, menor preço e mercados que têm). */
export function derivarItens(produtos) {
  const by = new Map();
  for (const p of produtos) {
    if (!p.term || p.term === 'ofertas') continue;
    const cur = by.get(p.term) || { term: p.term, category: p.category || 'Outros', n: 0, min: Infinity, stores: new Set() };
    cur.n++; cur.min = Math.min(cur.min, p.price); cur.stores.add(p.store);
    by.set(p.term, cur);
  }
  return [...by.values()].map((i) => ({ ...i, min: Math.round(i.min * 100) / 100, stores: [...i.stores] })).sort((a, b) => a.term.localeCompare(b.term, 'pt-BR'));
}
