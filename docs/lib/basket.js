// Cesta: preço de cada item em cada mercado, total por mercado e a mistura mais barata.
import { bestPerStore } from './match.js';

export function compute(list, products, stores) {
  const rows = list.map((it) => ({ item: it, per: bestPerStore(it.name, products, stores) }));
  const totals = Object.fromEntries(stores.map((s) => [s, { total: 0, found: 0, missing: 0, fill: 0, full: 0 }]));
  let mixTotal = 0, mixFound = 0;
  for (const r of rows) {
    let best = null;
    for (const s of stores) {
      const m = r.per[s];
      if (!m) { totals[s].missing++; continue; }
      const sub = m.product.price * r.item.qty;
      totals[s].total += sub;
      totals[s].found++;
      if (!best || sub < best.sub) best = { store: s, sub };
    }
    r.best = best;
    if (best) for (const s of stores) if (!r.per[s]) totals[s].fill += best.sub;   // item que o mercado não tem: custo no mais barato de outro lugar
    r.category = stores.map((s) => r.per[s]).find((m) => m && m.product.category)?.product.category || 'Outros';
    if (best) { mixTotal += best.sub; mixFound++; }
  }
  for (const s of stores) { totals[s].total = Math.round(totals[s].total * 100) / 100; totals[s].fill = Math.round(totals[s].fill * 100) / 100; totals[s].full = Math.round((totals[s].total + totals[s].fill) * 100) / 100; }
  return { rows, totals, mix: { total: Math.round(mixTotal * 100) / 100, found: mixFound, missing: list.length - mixFound }, priced: mixFound };
}

function* subsets(arr, k) {
  const rec = function* (start, picked) {
    if (picked.length === k) { yield picked.slice(); return; }
    for (let i = start; i < arr.length; i++) { picked.push(arr[i]); yield* rec(i + 1, picked); picked.pop(); }
  };
  yield* rec(0, []);
}

/**
 * Lista consolidada. Cada opção usa SÓ os mercados dela (1, 2 ou 3): a combinação que cobre mais itens e, no empate, a mais barata.
 * Cada item vai para o mais barato dentro da combinação. O que a combinação não tem NÃO entra na lista nem no total: vai para `uncovered`,
 * com o preço mais barato em outro mercado só como informação. Para comparar opções de forma justa, `fullEstimate` = total + o que falta
 * comprado no mais barato de outro lugar (a lista inteira), e a economia é calculada sobre ele.
 */
export function consolidate(out, stores, maxStores = 3) {
  const universe = out.rows.filter((r) => r.best);
  const noPrice = out.rows.length - universe.length;
  const options = [];
  for (let k = 1; k <= Math.min(maxStores, stores.length); k++) {
    let best = null;
    for (const combo of subsets(stores, k)) {
      let total = 0, covered = 0;
      const assign = {}, uncovered = [];
      for (const r of universe) {
        let pick = null;
        for (const s of combo) {
          const m = r.per[s];
          if (!m) continue;
          const sub = m.product.price * r.item.qty;
          if (!pick || sub < pick.sub) pick = { store: s, sub, product: m.product };
        }
        if (pick) { total += pick.sub; covered++; (assign[pick.store] ||= []).push({ item: r.item, category: r.category, product: pick.product, sub: pick.sub }); }
        else uncovered.push({ item: r.item, category: r.category, elsewhere: { store: r.best.store, product: r.per[r.best.store].product, sub: r.best.sub } });
      }
      total = Math.round(total * 100) / 100;
      if (!best || covered > best.covered || (covered === best.covered && total < best.total)) best = { combo, total, covered, assign, uncovered };
    }
    const used = best.combo.filter((s) => (best.assign[s] || []).length > 0);
    const fill = best.uncovered.reduce((t, u) => t + u.elsewhere.sub, 0);
    options.push({ k, stores: used, total: best.total, covered: best.covered, universe: universe.length, uncovered: best.uncovered, missing: noPrice,
      fullEstimate: Math.round((best.total + fill) * 100) / 100, assign: Object.fromEntries(used.map((s) => [s, best.assign[s]])) });
  }
  const base = options[0];
  for (const o of options) o.saving = base ? Math.round((base.fullEstimate - o.fullEstimate) * 100) / 100 : 0;
  return options;
}
