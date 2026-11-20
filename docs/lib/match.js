// Item da lista x produtos do catálogo: acha, em cada mercado, o produto mais barato que realmente é aquele item.
import { tokens, sizeOf } from './normalize.js';
import { nota, variantes } from './search.js';

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
  // tenta a frase como está e as equivalentes ("pasta de dente" = "creme dental"); vale a melhor
  let best = 0;
  for (const v of variantes(item)) best = Math.max(best, scoreUma(v, product));
  return best;
}

// Palavras que mudam o produto: se o produto tem uma delas e o item não pediu, não é o mesmo produto ("batata doce", "molho de tomate", "ovos de codorna").
const NEGATIVAS = ['conserva', 'doce', 'congelad', 'molho', 'extrato', 'sabor', 'recheio', 'codorna', 'acai', 'salada', 'frances', 'lactose', 'bebida', 'suco', 'iogurte', 'chocolate', 'em pedaco', 'palha', 'frita', 'chips', 'lays', 'pringles', 'ruffles', 'snack', 'salgadinho', 'pelado', 'pele', 'vinagre', 'defumado', 'cozido', 'desfiado', 'fatiado', 'liquido', 'puree', 'menu', 'macarronada', 'organico', 'saladete', 'perdigao', 'lanche', 'barra'];
// Tipos do mesmo produto: se o item pede um ("carioca") e o produto é de outro ("preto"), não serve.
const TIPOS = new Set(['integral', 'desnatado', 'semidesnatado', 'parboilizado', 'agulhinha', 'branco', 'preto', 'carioca', 'fradinho', 'vermelho', 'refinado', 'cristal', 'demerara', 'mascavo', 'tradicional']);
const comeca = (t, p) => t === p || t.startsWith(p);

function scoreUma(item, product) {
  const { words, sizes } = itemParts(item);
  if (!words.length) return 0;
  // todas as palavras do item no produto (sem tolerar erro de digitação: aqui é preço, não busca)
  if (nota(words, product, false) < 0.65) return 0;
  const pt = product._t.filter((x) => !sizeOf(x) && !/^\d/.test(x));
  const pset = new Set(product._t);
  // a palavra principal do item é o NOME do produto (1ª palavra do nome; item de várias palavras aceita a 2ª: "filé de peito de frango")
  const head = words[0];
  const pos = pt.findIndex((x) => comeca(x, head) || comeca(head, x) && x.length >= 4);
  if (pos < 0 || pos > (words.length > 1 ? 1 : 0)) return 0;
  // nada de produto trocado: palavra que muda o produto, ou tipo diferente do pedido
  for (const n of NEGATIVAS) if (!words.some((w) => w.startsWith(n)) && [...pset].some((x) => x.startsWith(n))) return 0;
  const itemTipos = words.filter((w) => TIPOS.has(w));
  if (itemTipos.length && [...pset].some((x) => TIPOS.has(x) && !itemTipos.includes(x))) return 0;
  const wantsPet = words.some((w) => PET.has(w));
  if (!wantsPet && [...pset].some((x) => PET.has(x))) return 0;
  const extras = pt.filter((x) => !words.some((w) => comeca(x, w) || comeca(w, x))).length;
  let s = 0.6 + 0.2 * (words.length / Math.max(pset.size, words.length)) - Math.min(0.1, extras * 0.012);
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
    let good = cands.filter((c) => c.sc >= top - 0.12);
    if (!sizes.length) {
      // item sem tamanho: fica com as embalagens de tamanho típico (mediana) e compara o preço da embalagem, não o do litro/quilo (senão vence o galão de 5 L)
      const withSize = good.filter((c) => c.p.size);
      if (withSize.length >= 3) {
        const byUnit = {};
        for (const c of withSize) (byUnit[c.p.size.unit] ||= []).push(c.p.size.amount);
        const unit = Object.keys(byUnit).sort((a, b) => byUnit[b].length - byUnit[a].length)[0];
        const sorted = byUnit[unit].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)];
        const near = good.filter((c) => c.p.size && c.p.size.unit === unit && c.p.size.amount >= med / 2 && c.p.size.amount <= med * 2);
        if (near.length) good = near;
      }
    }
    const key = (c) => c.p.price;
    good.sort((a, b) => key(a) - key(b) || b.sc - a.sc);
    byStore[st] = { product: good[0].p, score: good[0].sc, alternatives: good.slice(1, 4).map((c) => c.p) };
  }
  return byStore;
}
