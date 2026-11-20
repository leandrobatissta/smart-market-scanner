import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerEncarte, tamanhoDoNome, emProdutos, vigentes } from '../../docs/lib/encarte.js';

test('lerEncarte: nome e preço na mesma linha, com R$ e vírgula', () => {
  const r = lerEncarte('ARROZ TIPO 1 TIO JOAO 5KG R$ 22,90\nFEIJAO CARIOCA CAMIL 1KG 7,99\nLeite Integral 1L R$4,49');
  assert.deepEqual(r.map((o) => [o.name, o.price]), [['ARROZ TIPO 1 TIO JOAO 5KG', 22.9], ['FEIJAO CARIOCA CAMIL 1KG', 7.99], ['Leite Integral 1L', 4.49]]);
});

test('lerEncarte: linha só com o preço usa o nome da linha de cima; "de/por" fica com o menor; milhar e ruído', () => {
  const r = lerEncarte('CAFE PILAO TRADICIONAL 500G\nR$ 18,90\nOleo de Soja Liza 900ml de 9,50 por 7,99\nTV 50 POLEGADAS R$ 1.999,00\nR$ 5,00\n\nSabao em Po Omo 1,6kg R$ 24,90');
  assert.deepEqual(r.map((o) => [o.name, o.price]), [['CAFE PILAO TRADICIONAL 500G', 18.9], ['Oleo de Soja Liza 900ml', 7.99], ['Sabao em Po Omo 1,6kg', 24.9]]);  // TV acima de R$ 999 e preço sem nome ficam de fora
});

test('lerEncarte: sem repetidos, sem preço solto e texto vazio', () => {
  assert.equal(lerEncarte('Banana Caturra kg 5,49\nBanana Caturra kg 5,49').length, 1);
  assert.deepEqual(lerEncarte('SO TEXTO SEM PRECO\nOUTRA LINHA'), []);
  assert.deepEqual(lerEncarte(''), []);
});

test('tamanhoDoNome: kg, g, ml, litros e unidades', () => {
  assert.deepEqual(tamanhoDoNome('Arroz 5kg'), { amount: 5, unit: 'kg' });
  assert.deepEqual(tamanhoDoNome('Biscoito 130g'), { amount: 0.13, unit: 'kg' });
  assert.deepEqual(tamanhoDoNome('Suco 1,5 L'), { amount: 1.5, unit: 'l' });
  assert.deepEqual(tamanhoDoNome('Refri 350ml'), { amount: 0.35, unit: 'l' });
  assert.equal(tamanhoDoNome('Sabonete'), null);
});

test('emProdutos e vigentes: produto de encarte com validade, categoria, preço por kg; o vencido sai', () => {
  const ps = emProdutos([{ name: 'Arroz Tio Joao 5kg', price: 22.9 }, { name: 'Leite 1l', price: 4.49 }], { store: 'imperatriz', validUntil: '2026-11-29', categoria: (n) => (/arroz/i.test(n) ? 'Mercearia' : 'Outros') });
  assert.equal(ps[0].store, 'imperatriz');
  assert.equal(ps[0].category, 'Mercearia');
  assert.equal(ps[0].unitPrice, 4.58);
  assert.ok(ps[0].promo && ps[0].source === 'encarte');
  assert.equal(vigentes(ps, '2026-11-29').length, 2);   // vale até o fim do dia da validade
  assert.equal(vigentes(ps, '2026-11-30').length, 0);
  assert.equal(new Set(ps.map((p) => p.id)).size, 2);
});
