// Texto de lista e de produto -> palavras comparáveis (sem acento, minúsculas, singular simples, sem palavras de ligação).
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'para', 'tipo', 'pacote', 'pct', 'caixa', 'cx', 'embalagem', 'a', 'o', 'e', 'um', 'uma']);
const SIZE = /^(\d+(?:[.,]\d+)?)(kg|g|gr|mg|l|lt|litros?|ml|un|und|unid|unidades?)$/;

export function stripAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** "Arroz Tipo 1 5 kg" -> ['arroz','1','5kg'] (o tamanho vira um token só, g e ml ficam como estão). */
export function tokens(text) {
  const clean = stripAccents(String(text).toLowerCase()).replace(/(\d)\s+(kg|g|gr|mg|ml|l|lt|un|und)\b/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2');
  const out = [];
  for (const raw of clean.split(/[^a-z0-9.]+/)) {
    const t = raw.replace(/^\.+|\.+$/g, '');
    if (!t || STOP.has(t)) continue;
    out.push(singular(t));
  }
  return out;
}

function singular(t) {
  if (SIZE.test(t) || /^\d/.test(t)) return t;
  if (t.length > 4 && t.endsWith('oes')) return t.slice(0, -3) + 'ao';
  if (t.length >= 4 && t.endsWith('aes')) return t.slice(0, -3) + 'ao'; // pães, cães, mães
  if (t.length > 4 && t.endsWith('es') && /(r|z|s)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Tamanho em kg/l/un a partir de um token (g e ml convertidos). */
export function sizeOf(token) {
  const m = SIZE.exec(token);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = m[2];
  if (u === 'kg') return { amount: n, unit: 'kg' };
  if (u === 'g' || u === 'gr') return { amount: n / 1000, unit: 'kg' };
  if (u === 'mg') return { amount: n / 1e6, unit: 'kg' };
  if (u === 'l' || u === 'lt' || u.startsWith('litro')) return { amount: n, unit: 'l' };
  if (u === 'ml') return { amount: n / 1000, unit: 'l' };
  return { amount: n, unit: 'un' };
}
