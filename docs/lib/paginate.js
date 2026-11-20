// Paginação e filtros das grades de produtos (Promoções e Catálogo). Funções puras.
import { stripAccents } from './normalize.js';

/** Fatia a lista: { items, page, pages, total } com a página corrigida para dentro do limite. */
export function paginar(lista, page, porPagina = 24) {
  const total = lista.length;
  const pages = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: lista.slice((p - 1) * porPagina, p * porPagina), page: p, pages, total };
}

/** Números de página com reticências: [1, '…', 4, 5, 6, '…', 20]. */
export function janela(page, pages, ao_redor = 1) {
  const out = [];
  const mostrar = new Set([1, pages, page]);
  for (let i = 1; i <= ao_redor; i++) { mostrar.add(page - i); mostrar.add(page + i); }
  let anterior = 0;
  for (const n of [...mostrar].filter((x) => x >= 1 && x <= pages).sort((a, b) => a - b)) {
    if (n - anterior > 1) out.push('…');
    out.push(n); anterior = n;
  }
  return out;
}

const norm = (s) => stripAccents(String(s).toLowerCase());

/** Filtra por mercado, categoria e texto (sem acento, todas as palavras) e ordena. `ordem`: 'desconto' | 'menor' | 'maior' | 'nome'. */
export function filtrar(produtos, { store = 'todos', cat = 'todas', q = '', ordem = 'desconto' } = {}) {
  const palavras = norm(q).split(/\s+/).filter(Boolean);
  const out = produtos.filter((p) => (store === 'todos' || p.store === store) && (cat === 'todas' || p.category === cat)
    && palavras.every((w) => norm(`${p.name} ${p.brand || ''}`).includes(w)));
  const desc = (p) => (p.listPrice > p.price ? 1 - p.price / p.listPrice : 0);
  const cmp = {
    desconto: (a, b) => desc(b) - desc(a) || a.price - b.price,
    menor: (a, b) => a.price - b.price,
    maior: (a, b) => b.price - a.price,
    nome: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  }[ordem] || (() => 0);
  return out.sort(cmp);
}
