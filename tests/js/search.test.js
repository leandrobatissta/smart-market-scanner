import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distancia, variantes, prepararBase, sugerir } from '../../docs/lib/search.js';

const itens = [
  { term: 'arroz 5kg', category: 'Mercearia', n: 20, min: 17.6, stores: ['giassi'] },
  { term: 'creme dental', category: 'Higiene e beleza', n: 14, min: 3.5, stores: ['giassi'] },
  { term: 'sabao em po', category: 'Limpeza', n: 18, min: 9.9, stores: ['giassi'] },
  { term: 'refrigerante cola', category: 'Bebidas', n: 12, min: 6, stores: ['giassi'] },
  { term: 'cebola', category: 'Hortifruti', n: 5, min: 4, stores: ['giassi'] },
  { term: 'tomate', category: 'Hortifruti', n: 6, min: 5, stores: ['giassi'] },
  { term: 'cafe 500g', category: 'Mercearia', n: 25, min: 14, stores: ['giassi'] },
];
const produtos = [
  { id: 'g:1', store: 'giassi', name: 'Sabão em Pó Omo Lavagens Perfeitas 800g', brand: 'Omo', category: 'Limpeza', price: 12.9 },
  { id: 'g:2', store: 'giassi', name: 'Café Pilão Tradicional 500g', brand: 'Pilão', category: 'Mercearia', price: 19.9 },
];
const base = prepararBase(itens, produtos);
const top = (q) => sugerir(base, q, 5).map((s) => s.label);

test('distância de edição com corte', () => {
  assert.equal(distancia('cebola', 'cebola'), 0);
  assert.equal(distancia('cebola', 'cebolla'), 1);
  assert.ok(distancia('arroz', 'feijao', 2) > 2);
});

test('variantes: sinônimos entram sem perder a busca original', () => {
  assert.deepEqual(variantes('Pasta de Dente'), ['pasta de dente', 'creme dental']);
  assert.ok(variantes('refri').includes('refrigerante'));
  assert.deepEqual(variantes('  Arroz '), ['arroz']);
});

test('sugerir: prefixo, sem acento, erro de digitação e sinônimo', () => {
  assert.equal(top('arr')[0], 'arroz 5kg');
  assert.equal(top('café')[0], 'cafe 500g');
  assert.equal(top('cebolla')[0], 'cebola');           // erro de digitação
  assert.equal(top('tomat')[0], 'tomate');             // prefixo
  assert.equal(top('pasta de dente')[0], 'creme dental');
  assert.equal(top('refri')[0], 'refrigerante cola');
  assert.equal(top('sabão em pó')[0], 'sabao em po');
});

test('sugerir: itens da base antes dos produtos; produto específico aparece; vazio e curto não sugerem', () => {
  const r = sugerir(base, 'sabao em po', 5);
  assert.equal(r[0].kind, 'item');
  assert.ok(r.some((s) => s.kind === 'produto' && /Omo/.test(s.label)));
  assert.deepEqual(sugerir(base, 'a'), []);
  assert.deepEqual(sugerir(base, ''), []);
  assert.deepEqual(top('zzzzxq'), []);
});

import { derivarItens } from '../../docs/lib/search.js';

test('derivarItens: um item por termo, com categoria, contagem, menor preço e mercados', () => {
  const ps = [
    { term: 'arroz 5kg', category: 'Mercearia', store: 'giassi', price: 19.9 }, { term: 'arroz 5kg', category: 'Mercearia', store: 'forte', price: 17.99 },
    { term: 'cafe 500g', category: 'Mercearia', store: 'giassi', price: 15 }, { term: 'ofertas', category: 'Outros', store: 'bistek', price: 3 },
  ];
  const r = derivarItens(ps);
  assert.deepEqual(r.map((i) => i.term), ['arroz 5kg', 'cafe 500g']);       // 'ofertas' não é item
  assert.deepEqual([r[0].n, r[0].min, r[0].stores.sort()], [2, 17.99, ['forte', 'giassi']]);
});
