// Encarte importado (foto/PDF): linhas de texto lidas por OCR -> ofertas { name, price } -> produtos com validade que entram na comparação. Funções puras.
import { stripAccents } from './normalize.js';

const PRECO = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)[,.](\d{2})(?!\d)/g;
const RUIDO = /^(r\$|por|de|ate|ou|leve|pague|cada|kg|un|und|unid|pacote|oferta|ofertas|validade|valido|clube|cartao|super clube|imperatriz|preco|economize|compre|apenas|somente|a partir)$/i;

const num = (inteiro, cents) => parseFloat(`${inteiro.replace(/\./g, '')}.${cents}`);

/** Todos os preços de uma linha, com a posição em que aparecem. */
function precosDaLinha(linha) {
  const out = [];
  for (const m of linha.matchAll(PRECO)) {
    const v = num(m[1], m[2]);
    if (v > 0) out.push({ v, i: m.index, len: m[0].length });
  }
  return out;
}

const limpar = (s) => s.replace(/R\$/gi, ' ').replace(/[|_*•·►▪•]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-–:;,.]+|[\s\-–:;,.]+$/g, '').replace(/(\s+(de|por|a|ate|ou))+$/i, '').trim();
const ehNome = (s) => {
  const t = stripAccents(s).toLowerCase();
  const letras = (t.match(/[a-z]/g) || []).length;
  if (letras < 4 || RUIDO.test(t.trim())) return false;
  return t.split(/\s+/).some((w) => /[a-z]{3,}/.test(w));
};

/**
 * Do texto do encarte tira as ofertas: o preço é o da linha (ou, se a linha só tem o preço, o nome é a linha de cima).
 * Com dois preços na linha ("de 12,90 por 9,90") vale o MENOR (o da oferta). Preço fora de 0,01–999,99 e nome sem letras são descartados.
 */
export function lerEncarte(texto) {
  const linhas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  const vistos = new Set();
  for (let i = 0; i < linhas.length; i++) {
    const ps = precosDaLinha(linhas[i]);
    const validos = ps.filter((p) => p.v < 1000);   // acima de R$ 999,99 não é item de mercado (TV, eletro): a linha é ignorada
    if (!validos.length) continue;
    const preco = Math.min(...validos.map((p) => p.v));
    let nome = limpar(linhas[i].replace(PRECO, ' '));
    if (!ehNome(nome)) {
      // linha só com preço: o nome está na(s) linha(s) de cima (até 2), que não tenham preço
      const cima = [];
      for (let j = i - 1; j >= Math.max(0, i - 2); j--) { if (precosDaLinha(linhas[j]).length) break; cima.unshift(linhas[j]); }
      nome = limpar(cima.join(' '));
    }
    if (!ehNome(nome)) continue;
    nome = nome.slice(0, 90);
    const k = `${stripAccents(nome).toLowerCase()}|${preco}`;
    if (vistos.has(k)) continue;
    vistos.add(k); out.push({ name: nome, price: preco });
  }
  return out;
}

/** Tamanho pelo nome ("5kg", "900 ml", "12 un"); g e ml viram kg e l. */
export function tamanhoDoNome(nome) {
  let ultimo = null;
  for (const m of String(nome).matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|mg|l|lt|litros?|ml|un|und|unid|unidades?)\b/gi)) ultimo = m;
  if (!ultimo) return null;
  const n = parseFloat(ultimo[1].replace(',', '.')); const u = ultimo[2].toLowerCase();
  const base = { kg: ['kg', 1], g: ['kg', 0.001], gr: ['kg', 0.001], mg: ['kg', 1e-6], l: ['l', 1], lt: ['l', 1], ml: ['l', 0.001] }[u] || (u.startsWith('litro') ? ['l', 1] : ['un', 1]);
  const amount = n * base[1];
  return amount > 0 ? { amount: Math.round(amount * 1e6) / 1e6, unit: base[0] } : null;
}

/** Ofertas conferidas -> produtos do catálogo, marcados como encarte e com validade (AAAA-MM-DD). */
export function emProdutos(ofertas, { store, validUntil, categoria = () => 'Outros', url = '' }) {
  return ofertas.filter((o) => o.name && o.price > 0).map((o, i) => {
    const size = tamanhoDoNome(o.name);
    return {
      id: `${store}:enc:${validUntil}:${i}:${stripAccents(o.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
      store, name: o.name, brand: '', price: Math.round(o.price * 100) / 100, listPrice: Math.round(o.price * 100) / 100,
      size, unitPrice: size ? Math.round((o.price / size.amount) * 100) / 100 : null,
      url, image: null, term: 'encarte', category: categoria(o.name), promo: true, source: 'encarte', validUntil,
    };
  });
}

/** Só os que ainda valem hoje (a validade vale até o fim do dia). `hoje` no formato AAAA-MM-DD. */
export const vigentes = (produtos, hoje) => produtos.filter((p) => !p.validUntil || p.validUntil >= hoje);
