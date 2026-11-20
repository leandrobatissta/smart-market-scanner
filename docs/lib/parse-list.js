// Texto bruto (digitado, TXT, CSV, PDF, foto) -> itens da lista { name, qty }.
import { stripAccents } from './normalize.js';

const QTY_FIRST = /^\s*(\d+(?:[.,]\d+)?)\s*(?:x|un\.?|und\.?|unid\.?|unidades?|pcts?|cx)?\s+(?=\D)(.+)$/i;
const QTY_LAST = /^(.+?)\s*[-–:]?\s*\bx\s*(\d+)\s*$/i;
const BULLET = /^\s*(?:[-*•·▪◦►>]+|\d+[.)]|\[\s?[xX ]?\s?\])\s+/;
const NOISE = /^(lista|compras|lista de compras|mercado|supermercado|item|itens|produto|produtos|qtd|quantidade|total|data)\b[:\s]*$/i;

/** Uma linha -> item ou null. "2 leite", "2x leite", "leite x2", "arroz 5kg" (o 5kg fica no nome), "- feijão". */
export function parseLine(line) {
  let s = String(line).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(BULLET, '').trim();
  if (!s || NOISE.test(stripAccents(s))) return null;
  let qty = 1;
  const last = QTY_LAST.exec(s);
  if (last) { s = last[1].trim(); qty = parseInt(last[2], 10); } else {
    const first = QTY_FIRST.exec(s);
    // "2 leite" é quantidade; "5kg arroz" ou "1 litro leite" mantêm o tamanho no nome (a unidade não é de contagem)
    if (first && !/^\s*\d+(?:[.,]\d+)?\s*(kg|g|gr|mg|l|lt|litros?|ml)\b/i.test(s)) { qty = parseFloat(first[1].replace(',', '.')); s = first[2].trim(); }
  }
  s = s.replace(/[;|]+$/g, '').trim();
  if (s.length < 2 || !/[a-zA-ZÀ-ÿ]/.test(s) || !(qty > 0)) return null;
  return { name: s, qty: Math.min(Math.round(qty * 1000) / 1000, 999) };
}

/** Texto com várias linhas (ou itens separados por vírgula/ponto e vírgula numa linha só). */
export function parseText(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const parts = line.includes(';') || (line.split(',').length > 2 && !/\d,\d/.test(line)) ? line.split(/[;,]/) : [line];
    for (const p of parts) { const it = parseLine(p); if (it) out.push(it); }
  }
  return mergeDuplicates(out);
}

/** CSV/linhas de planilha: acha a coluna de nome e a de quantidade (por cabeçalho; senão 1ª coluna de texto e 1ª numérica). */
export function parseRows(rows) {
  const clean = rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
  if (!clean.length) return [];
  const head = clean[0].map((c) => stripAccents(c.toLowerCase()));
  const nameCol = head.findIndex((h) => /^(item|itens|produto|produtos|nome|descricao|lista)$/.test(h));
  const qtyCol = head.findIndex((h) => /^(qtd|qtde|quantidade|quant|un|unid)\.?$/.test(h));
  const hasHeader = nameCol >= 0 || qtyCol >= 0;
  const body = hasHeader ? clean.slice(1) : clean;
  const out = [];
  for (const r of body) {
    let nc = nameCol;
    if (nc < 0) nc = r.findIndex((c) => /[a-zA-ZÀ-ÿ]{2}/.test(c));
    if (nc < 0) continue;
    let name = r[nc];
    let qty = 1;
    if (qtyCol >= 0 && /^\d+([.,]\d+)?$/.test(r[qtyCol] || '')) qty = parseFloat(r[qtyCol].replace(',', '.'));
    else if (qtyCol < 0) { const num = r.find((c, i) => i !== nc && /^\d+([.,]\d+)?$/.test(c)); if (num) qty = parseFloat(num.replace(',', '.')); }
    const it = parseLine(qty !== 1 || qtyCol >= 0 ? name : name);
    if (it) out.push({ name: it.name, qty: qtyCol >= 0 || qty !== 1 ? qty : it.qty });
  }
  return mergeDuplicates(out);
}

/** Mesmo item repetido soma a quantidade. */
export function mergeDuplicates(items) {
  const map = new Map();
  for (const it of items) {
    const k = stripAccents(it.name.toLowerCase());
    const cur = map.get(k);
    if (cur) cur.qty = Math.min(cur.qty + it.qty, 999); else map.set(k, { ...it });
  }
  return [...map.values()];
}

/** Aplicação da importação: 'add' soma à lista atual, 'replace' troca a lista inteira. */
export function applyImport(current, imported, mode) {
  if (mode === 'replace') return mergeDuplicates(imported);
  return mergeDuplicates([...current, ...imported]);
}
