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
  P('giassi', 'Arroz Branco Tipo 1 Kiarroz 5kg', 19.99, { amount: 5, unit: 'kg' }, { category: 'Mercearia' }),
  P('giassi', 'Arroz Branco Tipo 1 Giassi 5kg', 17.61, { amount: 5, unit: 'kg' }, { category: 'Mercearia' }),
  P('giassi', 'Arroz para Cães Boby 5kg', 14.38, { amount: 5, unit: 'kg' }),
  P('giassi', 'Arroz Branco 1kg', 5.5, { amount: 1, unit: 'kg' }),
  P('forte', 'Arroz Branco Catarinão 5kg', 17.99, { amount: 5, unit: 'kg' }, { category: 'Mercearia' }),
  P('forte', 'Leite Integral 1L', 4.99, { amount: 1, unit: 'l' }, { category: 'Laticínios e frios' }),
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
  assert.equal(out.rows[0].category, 'Mercearia');
  assert.equal(out.rows[1].category, 'Laticínios e frios');
});

import { CESTA_BASICA } from '../../docs/lib/starter.js';

test('cesta básica: todos os itens são válidos, sem repetição e com quantidade positiva', () => {
  assert.ok(CESTA_BASICA.length >= 20);
  const seen = new Set();
  for (const it of CESTA_BASICA) {
    assert.ok(it.qty >= 1 && it.qty <= 999, it.name);
    assert.deepEqual(parseLine(it.name)?.name, it.name);
    assert.ok(!seen.has(it.name), 'repetido: ' + it.name);
    seen.add(it.name);
  }
});

import { consolidate } from '../../docs/lib/basket.js';

test('consolidate: cada opção usa só os mercados dela; 1, 2 e 3 mercados; economia sobre a lista inteira', () => {
  const cat = [
    P('a', 'Arroz 5kg', 20, { amount: 5, unit: 'kg' }), P('a', 'Leite Integral 1L', 5, { amount: 1, unit: 'l' }), P('a', 'Café 500g', 15, { amount: 0.5, unit: 'kg' }),
    P('b', 'Arroz 5kg', 18, { amount: 5, unit: 'kg' }), P('b', 'Leite Integral 1L', 6, { amount: 1, unit: 'l' }), P('b', 'Café 500g', 18, { amount: 0.5, unit: 'kg' }),
    P('c', 'Arroz 5kg', 25, { amount: 5, unit: 'kg' }), P('c', 'Leite Integral 1L', 4, { amount: 1, unit: 'l' }),
  ];
  const out = compute([{ name: 'arroz 5kg', qty: 1 }, { name: 'leite integral', qty: 2 }, { name: 'café 500g', qty: 1 }], cat, ['a', 'b', 'c']);
  const [one, two, three] = consolidate(out, ['a', 'b', 'c']);
  assert.deepEqual(one.stores, ['a']);
  assert.equal(one.total, 45);          // 20 + 10 + 15: a tem os 3 itens
  assert.equal(one.uncovered.length, 0);
  assert.equal(two.total, 43);
  assert.ok(two.stores.length <= 2 && two.saving === 2);
  assert.equal(three.total, 41);        // arroz b 18 + leite c 8 + café a 15
  assert.equal(three.saving, 4);
  for (const o of [one, two, three]) for (const s of Object.keys(o.assign)) assert.ok(o.stores.includes(s));   // nunca item em mercado fora da opção
});

test('consolidate: 1 mercado que não tem tudo NÃO manda item para outro; o que falta vai para uncovered e entra só na estimativa', () => {
  const cat = [P('a', 'Arroz 5kg', 20, { amount: 5, unit: 'kg' }), P('b', 'Arroz 5kg', 30, { amount: 5, unit: 'kg' }), P('b', 'Feijão 1kg', 9, { amount: 1, unit: 'kg' })];
  const out = compute([{ name: 'arroz 5kg', qty: 1 }, { name: 'feijão', qty: 1 }, { name: 'sabão', qty: 1 }], cat, ['a', 'b']);
  const [one, two] = consolidate(out, ['a', 'b']);
  assert.equal(one.universe, 2);          // 'sabão' sem preço em lugar nenhum: fora de todas
  assert.equal(one.missing, 1);
  assert.equal(one.covered, 2);           // b tem os 2 itens com preço; a só 1: vence quem cobre mais
  assert.deepEqual(one.stores, ['b']);
  assert.equal(one.total, 39);
  assert.equal(one.uncovered.length, 0);
  assert.deepEqual(two.stores.sort(), ['a', 'b']);
  assert.equal(two.total, 29);            // arroz em a (20) + feijão em b (9)
  assert.equal(two.saving, 10);
});

test('consolidate: quando nenhum mercado tem tudo, o que falta aparece em uncovered com o preço de outro lugar (fora do total)', () => {
  const cat = [P('a', 'Arroz 5kg', 20, { amount: 5, unit: 'kg' }), P('b', 'Feijão 1kg', 9, { amount: 1, unit: 'kg' })];
  const out = compute([{ name: 'arroz 5kg', qty: 1 }, { name: 'feijão', qty: 1 }], cat, ['a', 'b']);
  const [one] = consolidate(out, ['a', 'b']);
  assert.equal(one.covered, 1);
  assert.equal(one.uncovered.length, 1);
  assert.equal(one.uncovered[0].elsewhere.store === 'a' || one.uncovered[0].elsewhere.store === 'b', true);
  assert.equal(one.fullEstimate, 29);     // total do que cobre + o que falta no mais barato de outro lugar
  assert.equal(Object.values(one.assign).flat().length, 1);
});

test('compute: total justo de cada mercado = lista inteira (o que falta é completado no mais barato de outro lugar)', () => {
  const cat = [P('a', 'Arroz 5kg', 20, { amount: 5, unit: 'kg' }), P('b', 'Arroz 5kg', 30, { amount: 5, unit: 'kg' }), P('b', 'Feijão 1kg', 9, { amount: 1, unit: 'kg' })];
  const out = compute([{ name: 'arroz 5kg', qty: 1 }, { name: 'feijão', qty: 1 }], cat, ['a', 'b']);
  assert.deepEqual([out.totals.a.total, out.totals.a.fill, out.totals.a.full], [20, 9, 29]);
  assert.deepEqual([out.totals.b.total, out.totals.b.fill, out.totals.b.full], [39, 0, 39]);
});
