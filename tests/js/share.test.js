import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupOption, buildText, buildCsv, whatsappUrl, mailtoUrl, title } from '../../docs/lib/share.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const names = { a: 'Giassi', b: 'Bistek' };
const entry = (qty, want, name, category, price) => ({ item: { name: want, qty }, category, product: { name, price, url: 'https://x/p' }, sub: price * qty });
const OPTION = { k: 2, stores: ['a', 'b'], total: 70, covered: 3, universe: 4, uncovered: [{ item: { name: 'sabão', qty: 1 } }], missing: 1, saving: 5, assign: {
  a: [entry(2, 'leite', 'Leite Integral 1L', 'Laticínios', 5), entry(1, 'arroz', 'Arroz 5kg', 'Mercearia', 20)],
  b: [entry(1, 'café', '=Café 500g', 'Mercearia', 40)],
} };

test('groupOption: por mercado e categoria, ordenado, com total', () => {
  const g = groupOption(OPTION, names);
  assert.equal(g[0].store, 'Giassi');
  assert.equal(g[0].total, 30);
  assert.deepEqual(g[0].groups.map((x) => x.category), ['Laticínios', 'Mercearia']);
  assert.equal(title(OPTION), 'Compra em 2 mercados');
});

test('buildText: cabeçalho, mercados em negrito, itens, aviso do que falta', () => {
  const t = buildText(OPTION, names, brl, '20/11/2026');
  assert.match(t, /^Lista de compras · 20\/11\/2026\nCompra em 2 mercados/);
  assert.match(t, /\*Giassi\* — R\$\s?30,00/);
  assert.match(t, /• 2x Leite Integral 1L — R\$\s?10,00/);
  assert.match(t, /Sem preço em nenhum mercado: 1 item/);
  assert.match(t, /\(3 de 4 itens\)/);
  assert.match(t, /Não encontrados nestes mercados: sabão\./);
});

test('buildCsv: BOM, separador ;, vírgula decimal e proteção contra fórmula', () => {
  const c = buildCsv(OPTION, names);
  assert.ok(c.startsWith('﻿Mercado;Categoria;Item;Produto'));
  assert.match(c, /Giassi;Laticínios;leite;Leite Integral 1L;2;5,00;10,00/);
  assert.match(c, /Bistek;Mercearia;café;'=Café 500g;1;40,00;40,00/);
});

test('links: WhatsApp codificado e e-mail cortado com aviso quando é longo', () => {
  assert.equal(whatsappUrl('a b\n1'), 'https://wa.me/?text=a%20b%0A1');
  const short = mailtoUrl('Lista', 'curta');
  assert.equal(short, 'mailto:?subject=Lista&body=curta');
  const long = mailtoUrl('Lista', 'x'.repeat(5000), 600);
  assert.ok(long.length < 900);
  assert.match(decodeURIComponent(long), /lista cortada/);
});

import { agrupar, validade, PRIORIDADE } from '../../docs/lib/encartes.js';

test('encartes: validade em português e redes prioritárias primeiro, na ordem pedida', () => {
  assert.equal(validade({ start: '2026-11-18', end: '2026-11-29' }, '2026-11-20'), 'até 29/11');
  assert.equal(validade({ start: '2026-11-25', end: '2026-12-02' }, '2026-11-20'), 'começa 25/11');
  assert.equal(validade({ start: '2026-11-18', end: '2026-11-20' }, '2026-11-20'), 'termina hoje');
  const items = [
    { store: 'komprao', title: 'K', start: '2026-11-18', end: '2026-11-22' },
    { store: 'forte', title: 'B', start: '2026-11-18', end: '2026-11-25' }, { store: 'forte', title: 'A', start: '2026-11-18', end: '2026-11-22' },
    { store: 'imperatriz', title: 'I', start: '2026-11-18', end: '2026-11-29' },
    { store: 'giassi', title: 'G', start: '2026-11-18', end: '2026-11-26' },
  ];
  const g = agrupar(items, { komprao: 'Komprão', forte: 'Fort Atacadista', imperatriz: 'Super Imperatriz', giassi: 'Giassi' });
  assert.deepEqual(g.map((x) => x.store), ['imperatriz', 'giassi', 'forte', 'komprao']);
  assert.deepEqual(g[2].items.map((e) => e.title), ['A', 'B']);   // termina antes primeiro
  assert.deepEqual(PRIORIDADE, ['imperatriz', 'giassi', 'angeloni', 'bistek', 'forte']);
});
