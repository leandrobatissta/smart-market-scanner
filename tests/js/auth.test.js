import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarUsuario, entrar, hashSenha, iguais, tentativa, bloqueado } from '../../docs/lib/auth.js';

const IT = 2000;   // poucas iterações só nos testes (rápido)

test('hashSenha: determinístico com o mesmo sal e diferente com outro sal ou outra senha', async () => {
  const u = await criarUsuario('leandro', 'Leandro', 'segredo', IT);
  assert.equal(await hashSenha('segredo', u.salt, IT), u.hash);
  assert.notEqual(await hashSenha('Segredo', u.salt, IT), u.hash);
  const v = await criarUsuario('leandro', 'Leandro', 'segredo', IT);
  assert.notEqual(v.hash, u.hash);                      // sal aleatório: o mesmo senha não dá o mesmo hash
  assert.ok(!JSON.stringify(u).includes('segredo'));    // a senha nunca vai junto
});

test('entrar: senha certa, errada, usuário sem diferenciar maiúsculas e usuário inexistente', async () => {
  const lista = [await criarUsuario('leandro', 'Leandro', 'abc123', IT), await criarUsuario('suelen', 'Suelen', 'xyz789', IT)];
  assert.deepEqual(await entrar(lista, 'Leandro', 'abc123'), { user: 'leandro', name: 'Leandro' });
  assert.deepEqual(await entrar(lista, ' SUELEN ', 'xyz789'), { user: 'suelen', name: 'Suelen' });
  assert.equal(await entrar(lista, 'leandro', 'xyz789'), null);     // senha de outro usuário
  assert.equal(await entrar(lista, 'leandro', ''), null);
  assert.equal(await entrar(lista, 'ninguem', 'abc123'), null);
  assert.equal(await entrar([], 'leandro', 'abc123'), null);
});

test('iguais: compara inteiro e tamanhos diferentes não batem', () => {
  assert.ok(iguais('abc', 'abc'));
  assert.ok(!iguais('abc', 'abd'));
  assert.ok(!iguais('abc', 'abcd'));
});

test('tentativa: 5 erros seguidos bloqueiam por 30 s e um acerto zera', () => {
  let e = { erros: 0, ate: 0 };
  for (let i = 0; i < 4; i++) { e = tentativa(e, false, 1000); assert.equal(bloqueado(e, 1000), false); }
  e = tentativa(e, false, 1000);
  assert.equal(bloqueado(e, 1000), true);
  assert.equal(bloqueado(e, 1000 + 30_001), false);
  assert.deepEqual(tentativa(e, true, 5000), { erros: 0, ate: 0 });
});
