import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokens, sizeOf } from '../../docs/lib/normalize.js';
import { parseLine, parseText, parseRows, applyImport } from '../../docs/lib/parse-list.js';
import { prepare, score, bestPerStore } from '../../docs/lib/match.js';
import { compute } from '../../docs/lib/basket.js';

test('tokens: sem acento, singular, sem palavra de ligação e tamanho colado', () => {
  assert.deepEqual(tokens('Feijão Preto 1 kg'), ['feijao', 'preto', '1kg']);
  assert.deepEqual(tokens('Pães de Forma'), ['pao', 'forma']);
  assert.deepEqual(sizeOf('500g'), { amount: 0.5, unit: 'kg' });
  assert.deepEqual(sizeOf('1.5l'), { amount: 1.5, unit: 'l' });
  assert.equal(sizeOf('arroz'), null);
});

test('parseLine: quantidade antes, depois, marcador e tamanho no nome', () => {
  assert.deepEqual(parseLine('2 leite integral'), { name: 'leite integral', qty: 2 });
  assert.deepEqual(parseLine('3x ovos'), { name: 'ovos', qty: 3 });
  assert.deepEqual(parseLine('café x2'), { name: 'café', qty: 2 });
  assert.deepEqual(parseLine('- arroz 5kg'), { name: 'arroz 5kg', qty: 1 });
  assert.deepEqual(parseLine('1 litro leite'), { name: '1 litro leite', qty: 1 });
  assert.equal(parseLine('Lista de compras'), null);
  assert.equal(parseLine('   '), null);
  assert.equal(parseLine('123'), null);
});

test('parseText: várias linhas, itens separados por ponto e vírgula e duplicados somados', () => {
  const t = parseText('Lista de compras\n2 leite\n1. arroz 5kg\nfeijão; macarrão; café\n3 leite');
  assert.deepEqual(t.map((i) => [i.name, i.qty]), [['leite', 5], ['arroz 5kg', 1], ['feijão', 1], ['macarrão', 1], ['café', 1]]);
});

test('parseRows: cabeçalho de planilha e linhas sem cabeçalho', () => {
  assert.deepEqual(parseRows([['Item', 'Qtd'], ['Arroz 5kg', '2'], ['Feijão', '1']]), [{ name: 'Arroz 5kg', qty: 2 }, { name: 'Feijão', qty: 1 }]);
  assert.deepEqual(parseRows([['leite', '3'], ['ovos', '']]).map((i) => [i.name, i.qty]), [['leite', 3], ['ovos', 1]]);
});

test('applyImport: adicionar soma à lista atual; substituir troca tudo', () => {
  const cur = [{ name: 'leite', qty: 1 }, { name: 'ovos', qty: 12 }];
  const imp = [{ name: 'Leite', qty: 2 }, { name: 'café', qty: 1 }];
  assert.deepEqual(applyImport(cur, imp, 'add').map((i) => [i.name, i.qty]), [['leite', 3], ['ovos', 12], ['café', 1]]);
  assert.deepEqual(applyImport(cur, imp, 'replace').map((i) => [i.name, i.qty]), [['Leite', 2], ['café', 1]]);
});

const P = (store, name, price, size, extra = {}) => prepare({ id: `${store}:${name}`, store, name, brand: '', price, size, unitPrice: size ? Math.round((price / size.amount) * 100) / 100 : null, ...extra });
const CAT = [
  P('giassi', 'Arroz Branco Tipo 1 Kiarroz 5kg', 19.99, { amount: 5, unit: 'kg' }),
  P('giassi', 'Arroz Branco Tipo 1 Giassi 5kg', 17.61, { amount: 5, unit: 'kg' }),
  P('giassi', 'Arroz para Cães Boby 5kg', 14.38, { amount: 5, unit: 'kg' }),
  P('giassi', 'Arroz Branco 1kg', 5.5, { amount: 1, unit: 'kg' }),
  P('forte', 'Arroz Branco Catarinão 5kg', 17.99, { amount: 5, unit: 'kg' }),
  P('forte', 'Leite Integral 1L', 4.99, { amount: 1, unit: 'l' }),
];

test('score: exige todas as palavras, descarta ração quando o item não é pet e valoriza o tamanho certo', () => {
  assert.equal(score('arroz 5kg', CAT[2]), 0);
  assert.equal(score('feijão', CAT[0]), 0);
  assert.ok(score('arroz 5kg', CAT[0]) > score('arroz 5kg', CAT[3]));
  assert.ok(score('arroz', CAT[0]) >= 0.55);
});

test('bestPerStore: o mais barato entre os certos; sem produto = null', () => {
  const r = bestPerStore('arroz 5kg', CAT, ['giassi', 'forte', 'bistek']);
  assert.equal(r.giassi.product.price, 17.61);
  assert.equal(r.forte.product.price, 17.99);
  assert.equal(r.bistek, null);
});

test('compute: total por mercado, itens que faltam e a cesta mais barata misturando mercados', () => {
  const out = compute([{ name: 'arroz 5kg', qty: 2 }, { name: 'leite integral', qty: 3 }], CAT, ['giassi', 'forte']);
  assert.equal(out.totals.giassi.total, 35.22);
  assert.equal(out.totals.giassi.missing, 1);
  assert.equal(out.totals.forte.total, 50.95);
  assert.equal(out.mix.total, 50.19);
  assert.equal(out.rows[0].best.store, 'giassi');
});
