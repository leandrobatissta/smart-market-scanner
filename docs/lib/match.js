// Item da lista x produtos do catálogo: acha, em cada mercado, o produto mais barato que realmente é aquele item.
import { tokens, sizeOf } from './normalize.js';

const PET = new Set(['cao', 'caes', 'cachorro', 'gato', 'gatos', 'pet', 'racao']);

/** Prepara o produto uma vez (tokens do nome). */
export function prepare(p) {
  return { ...p, _t: tokens(`${p.name} ${p.brand || ''}`) };
}

function itemParts(name) {
  const t = tokens(name);
  const words = t.filter((x) => !sizeOf(x) && !/^\d/.test(x));
  const sizes = t.filter((x) => sizeOf(x)).map(sizeOf);
  return { words, sizes };
}

/** Nota de 0 a 1 de quanto o produto é o item; 0 = não é. Todas as palavras do item precisam estar no produto. */
export function score(item, product) {
  const { words, sizes } = itemParts(item);
  if (!words.length) return 0;
  const pt = new Set(product._t);
  let hit = 0;
  for (const w of words) if (pt.has(w) || [...pt].some((x) => x.length > 4 && w.length > 4 && (x.startsWith(w) || w.startsWith(x)))) hit++;
  if (hit < words.length) return 0;
  const wantsPet = words.some((w) => PET.has(w));
  if (!wantsPet && [...pt].some((x) => PET.has(x))) return 0;
  let s = 0.6 + 0.2 * (words.length / Math.max(pt.size, words.length));
  if (sizes.length) {
    const ps = product.size;
    if (ps && sizes.some((z) => z.unit === ps.unit && Math.abs(z.amount - ps.amount) / z.amount < 0.02)) s += 0.2; else s -= 0.15;
  }
  return Math.max(0, Math.min(1, s));
}

/** Melhor produto de cada mercado para o item: nota mínima, e entre os bons o de menor preço (ou menor preço por kg/l se o item não pede tamanho). */
export function bestPerStore(item, products, stores) {
  const { sizes } = itemParts(item);
  const byStore = {};
  for (const st of stores) {
    const cands = [];
    for (const p of products) {
      if (p.store !== st) continue;
      const sc = score(item, p);
      if (sc >= 0.55) cands.push({ p, sc });
    }
    if (!cands.length) { byStore[st] = null; continue; }
    const top = Math.max(...cands.map((c) => c.sc));
    const good = cands.filter((c) => c.sc >= top - 0.12);
    const key = (c) => (sizes.length || c.p.unitPrice == null ? c.p.price : c.p.unitPrice);
    good.sort((a, b) => key(a) - key(b) || b.sc - a.sc);
    byStore[st] = { product: good[0].p, score: good[0].sc, alternatives: good.slice(1, 4).map((c) => c.p) };
  }
  return byStore;
}
