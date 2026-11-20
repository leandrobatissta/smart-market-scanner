import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adicionar, ativos, chave, codigo6, falaDaLista, limpar, mesclar, reconciliar, remover } from '../../docs/lib/lista-sync.js';

const T0 = 1_700_000_000_000;

test('chave: sem acento, minúscula e espaços únicos', () => { assert.equal(chave('  Café  Pilão '), 'cafe pilao'); });

test('mesclar: vale o mais novo por item; empate fica o apagado; ordem estável', () => {
  const a = [{ name: 'leite', qty: 2, t: T0 }, { name: 'arroz', qty: 1, t: T0 + 5 }];
  const b = [{ name: 'LEITE', qty: 6, t: T0 + 10 }, { name: 'arroz', qty: 1, t: T0 + 5, del: true }, { name: 'ovos', qty: 12, t: T0 }];
  const m = mesclar(a, b, T0 + 100);
  assert.deepEqual(m.map((i) => [i.name, i.qty, !!i.del]), [['LEITE', 6, false], ['arroz', 1, true], ['ovos', 12, false]]);
  assert.deepEqual(ativos(m).map((i) => i.name), ['LEITE', 'ovos']);
});

test('mesclar: descarta tombstone com mais de 30 dias e itens inválidos', () => {
  const m = mesclar([{ name: 'velho', qty: 1, t: T0, del: true }, { name: '', qty: 1, t: T0 }, null, { name: 'ok', qty: 1, t: T0 }], [], T0 + 31 * 24 * 3600 * 1000);
  assert.deepEqual(m.map((i) => i.name), ['ok']);
});

test('adicionar soma a quantidade do item existente (sem acento) e cria o novo; remover apaga e acha por parte do nome', () => {
  let l = adicionar([], 'Café', 1, T0);
  l = adicionar(l, 'cafe', 2, T0 + 1);
  assert.deepEqual(ativos(l).map((i) => [i.name, i.qty]), [['Café', 3]]);
  l = adicionar(l, 'leite integral', 1, T0 + 2);
  const r = remover(l, 'leite', T0 + 3);
  assert.equal(r.achou, true);
  assert.deepEqual(ativos(r.itens).map((i) => i.name), ['Café']);
  assert.equal(remover(r.itens, 'sabonete', T0 + 4).achou, false);
});

test('mudanças no mesmo milissegundo não se perdem (a nova é sempre mais nova que a anterior)', () => {
  let l = adicionar([], 'leite', 1, T0);
  l = adicionar(l, 'leite', 2, T0);
  assert.equal(ativos(l)[0].qty, 3);
  const r = remover(l, 'leite', T0);
  assert.equal(ativos(r.itens).length, 0);
  l = adicionar(r.itens, 'leite', 1, T0);   // volta depois de apagado no mesmo instante
  assert.equal(ativos(l).length, 1);
});

test('limpar apaga todos; reconciliar marca o que mudou e cria tombstone do removido', () => {
  const base = adicionar(adicionar([], 'arroz', 1, T0), 'leite', 2, T0);
  assert.equal(ativos(limpar(base, T0 + 5)).length, 0);
  const depois = [{ name: 'arroz', qty: 3 }, { name: 'ovos', qty: 12 }];   // leite saiu, arroz mudou, ovos novo
  const r = reconciliar(base, depois, T0 + 50);
  const by = Object.fromEntries(r.map((i) => [chave(i.name), i]));
  assert.deepEqual([by.arroz.qty, by.arroz.t], [3, T0 + 50]);
  assert.equal(by.leite.del, true);
  assert.equal(by.ovos.qty, 12);
  const igual = reconciliar(r, [{ name: 'arroz', qty: 3 }, { name: 'ovos', qty: 12 }], T0 + 99);
  assert.equal(by.arroz.t, igual.find((i) => chave(i.name) === 'arroz').t);   // sem mudança, o t não anda
});

test('codigo6 tem 6 dígitos; falaDaLista em português com plural', () => {
  assert.match(codigo6([1, 2, 3, 4]), /^\d{6}$/);
  assert.equal(codigo6([0]), '000000');
  assert.equal(falaDaLista([]), 'Sua lista está vazia.');
  assert.equal(falaDaLista([{ name: 'leite', qty: 1, t: 1 }]), 'Sua lista tem 1 item: leite.');
  assert.equal(falaDaLista([{ name: 'leite', qty: 2, t: 1 }, { name: 'pão', qty: 1, t: 1 }, { name: 'ovos', qty: 1, t: 1, del: true }, { name: 'café', qty: 1, t: 1 }]), 'Sua lista tem 3 itens: 2 leite, pão e café.');
});
