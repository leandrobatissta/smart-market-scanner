// Encartes: ordem das redes (as pedidas primeiro), rótulo de validade e agrupamento por rede. Funções puras.
export const PRIORIDADE = ['imperatriz', 'giassi', 'angeloni', 'bistek', 'forte'];

const dm = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

/** "até 22/11" (vigente), "começa 25/11" (futuro) ou "termina hoje". `today` no formato AAAA-MM-DD. */
export function validade(enc, today) {
  if (enc.end === today) return 'termina hoje';
  if (enc.start > today) return `começa ${dm(enc.start)}`;
  return `até ${dm(enc.end)}`;
}

/** [{ store, name, items }] com as redes prioritárias primeiro (na ordem pedida) e as demais em ordem alfabética; dentro da rede, o que termina antes vem antes. */
export function agrupar(items, names = {}) {
  const by = new Map();
  for (const e of items) by.set(e.store, [...(by.get(e.store) || []), e]);
  const rank = (s) => { const i = PRIORIDADE.indexOf(s); return i < 0 ? 99 : i; };
  return [...by.keys()]
    .sort((a, b) => rank(a) - rank(b) || (names[a] || a).localeCompare(names[b] || b, 'pt-BR'))
    .map((s) => ({ store: s, name: names[s] || s, items: by.get(s).sort((x, y) => x.end.localeCompare(y.end) || x.title.localeCompare(y.title, 'pt-BR')) }));
}
