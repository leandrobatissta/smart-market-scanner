import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginar, janela, filtrar } from '../../docs/lib/paginate.js';

test('paginar: fatias, página fora do limite volta para dentro, lista vazia tem 1 página', () => {
  const l = Array.from({ length: 50 }, (_, i) => i);
  const a = paginar(l, 1, 24); assert.deepEqual([a.items.length, a.pages, a.total], [24, 3, 50]);
  const c = paginar(l, 3, 24); assert.deepEqual([c.items.length, c.page], [2, 3]);
  assert.equal(paginar(l, 99, 24).page, 3);
  assert.equal(paginar(l, -5, 24).page, 1);
  assert.deepEqual([paginar([], 1).pages, paginar([], 1).items.length], [1, 0]);
});

test('janela: números de página com reticências', () => {
  assert.deepEqual(janela(1, 3), [1, 2, 3]);
  assert.deepEqual(janela(1, 20), [1, 2, '…', 20]);
  assert.deepEqual(janela(10, 20), [1, '…', 9, 10, 11, '…', 20]);
  assert.deepEqual(janela(20, 20), [1, '…', 19, 20]);
  assert.deepEqual(janela(1, 1), [1]);
});

const P = (store, name, price, list, category = 'Mercearia', brand = '') => ({ store, name, price, listPrice: list ?? price, category, brand });
const L = [P('a', 'Café Pilão 500g', 19, 25), P('a', 'Arroz Camil 5kg', 22, 22), P('b', 'Cafe Melitta 500g', 18, 18, 'Mercearia', 'Melitta'), P('b', 'Sabão Omo', 15, 20, 'Limpeza')];

test('filtrar: mercado, categoria, texto sem acento (todas as palavras) e ordenação', () => {
  assert.equal(filtrar(L, { store: 'a' }).length, 2);
  assert.equal(filtrar(L, { cat: 'Limpeza' }).length, 1);
  assert.deepEqual(filtrar(L, { q: 'cafe 500' }).map((p) => p.name), ['Café Pilão 500g', 'Cafe Melitta 500g']);   // sem acento e por desconto
  assert.deepEqual(filtrar(L, { q: 'melitta' }).map((p) => p.store), ['b']);    // acha pela marca
  assert.deepEqual(filtrar(L, { ordem: 'menor' }).map((p) => p.price), [15, 18, 19, 22]);
  assert.deepEqual(filtrar(L, { ordem: 'maior' }).map((p) => p.price), [22, 19, 18, 15]);
  assert.equal(filtrar(L, { ordem: 'desconto' })[0].name, 'Sabão Omo');          // 25% de desconto
  assert.deepEqual(filtrar(L, { ordem: 'nome' }).map((p) => p.name)[0], 'Arroz Camil 5kg');
  assert.equal(filtrar(L, { q: 'zzz' }).length, 0);
});
