// Cesta: preço de cada item em cada mercado, total por mercado e a mistura mais barata.
import { bestPerStore } from './match.js';

export function compute(list, products, stores) {
  const rows = list.map((it) => ({ item: it, per: bestPerStore(it.name, products, stores) }));
  const totals = Object.fromEntries(stores.map((s) => [s, { total: 0, found: 0, missing: 0 }]));
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
    if (best) { mixTotal += best.sub; mixFound++; }
  }
  for (const s of stores) totals[s].total = Math.round(totals[s].total * 100) / 100;
  return { rows, totals, mix: { total: Math.round(mixTotal * 100) / 100, found: mixFound, missing: list.length - mixFound } };
}
