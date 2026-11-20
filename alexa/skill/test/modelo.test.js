// Regras da Amazon para o modelo de voz e o manifesto, conferidas aqui para não descobrir o erro só ao cadastrar a skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ler = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const modelo = ler('../skill-package/interactionModels/custom/pt-BR.json').interactionModel.languageModel;
const manifesto = ler('../skill-package/skill.json').manifest;
const intents = modelo.intents;
const amostras = intents.flatMap((i) => (i.samples || []).map((s) => ({ intent: i.name, s })));

test('nome de invocação: 2+ palavras, só letras minúsculas, sem palavras reservadas', () => {
  const n = modelo.invocationName;
  assert.match(n, /^[a-zà-ú]+( [a-zà-ú]+)+$/);
  assert.ok(n.length >= 3 && n.length <= 50);
  for (const proibida of ['alexa', 'amazon', 'echo', 'skill', 'aplicativo', 'app']) assert.ok(!n.split(' ').includes(proibida), proibida);
});

test('frases de exemplo: sem repetição entre intenções, sem número nem pontuação, e sempre com texto além do espaço reservado', () => {
  const vistos = new Map();
  for (const { intent, s } of amostras) {
    const k = s.toLowerCase();
    assert.ok(!vistos.has(k), `frase repetida: "${s}" (${vistos.get(k)} e ${intent})`);
    vistos.set(k, intent);
    assert.ok(!/[0-9.,;:!?"“”()]/.test(s), `número ou pontuação em "${s}"`);
    assert.ok(s.replace(/\{[a-z]+\}/g, '').trim().length > 0, `frase só com espaço reservado: "${s}"`);
  }
  assert.ok(amostras.length >= 20);
});

test('espaços reservados: todos definidos na intenção, sem repetir na mesma frase e de tipo conhecido', () => {
  const tiposCustom = new Set((modelo.types || []).map((t) => t.name));
  for (const i of intents) {
    const slots = new Map((i.slots || []).map((s) => [s.name, s.type]));
    for (const [nome, tipo] of slots) assert.ok(tipo.startsWith('AMAZON.') || tiposCustom.has(tipo), `${i.name}.${nome}: tipo ${tipo} não existe`);
    for (const s of i.samples || []) {
      const usados = [...s.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]);
      assert.equal(new Set(usados).size, usados.length, `espaço repetido em "${s}"`);
      for (const u of usados) assert.ok(slots.has(u), `"${s}" usa {${u}} não definido em ${i.name}`);
    }
  }
});

test('intenções nativas e as nossas: nomes únicos e as que o código trata existem no modelo', () => {
  const nomes = intents.map((i) => i.name);
  assert.equal(new Set(nomes).size, nomes.length);
  const codigo = readFileSync(new URL('../lambda/index.js', import.meta.url), 'utf8');
  for (const tratada of [...codigo.matchAll(/intent\('([A-Za-z.]+)'/g)].map((m) => m[1]).concat(['AMAZON.StopIntent', 'AMAZON.CancelIntent'])) assert.ok(nomes.includes(tratada), `o código trata ${tratada}, que falta no modelo`);
  for (const obrigatoria of ['AMAZON.CancelIntent', 'AMAZON.HelpIntent', 'AMAZON.StopIntent', 'AMAZON.FallbackIntent']) assert.ok(nomes.includes(obrigatoria), obrigatoria);
});

test('tipo Mercadoria: valores únicos, não vazios e sem pontuação', () => {
  const valores = modelo.types.find((t) => t.name === 'Mercadoria').values.map((v) => v.name.value);
  assert.ok(valores.length >= 50);
  assert.equal(new Set(valores.map((v) => v.toLowerCase())).size, valores.length);
  for (const v of valores) { assert.ok(v.trim().length > 0 && v.length <= 140); assert.ok(!/[.,;:!?]/.test(v), v); }
});

test('manifesto: nome, resumo e descrição dentro dos limites, três frases de exemplo com o nome de invocação', () => {
  const pt = manifesto.publishingInformation.locales['pt-BR'];
  assert.ok(pt.name.length <= 50 && pt.summary.length <= 120 && pt.description.length <= 4000, 'limites de tamanho');
  assert.equal(pt.examplePhrases.length, 3);
  for (const f of pt.examplePhrases) { assert.match(f, /^Alexa, /); assert.ok(f.toLowerCase().includes(modelo.invocationName), f); }
  assert.ok(pt.keywords.every((k) => k.length <= 50));
  assert.equal(manifesto.manifestVersion, '1.0');
});
