import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {}; globalThis.document = {};
const { parseCsv } = await import('../../docs/lib/import.js');

test('parseCsv: separador detectado, aspas e linhas vazias', () => {
  assert.deepEqual(parseCsv('item;qtd\narroz;2\n\n"leite, integral";3\n'), [['item', 'qtd'], ['arroz', '2'], ['leite, integral', '3']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('x\ty\n"a ""b"""\t1'), [['x', 'y'], ['a "b"', '1']]);
});
