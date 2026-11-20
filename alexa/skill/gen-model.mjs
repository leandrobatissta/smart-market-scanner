// Gera o modelo de voz (pt-BR) com os itens de scanner/terms.txt como exemplos do tipo "Mercadoria".
// Uso: node gen-model.mjs > skill-package/interactionModels/custom/pt-BR.json
import { readFileSync } from 'node:fs';
const termos = readFileSync(new URL('../../scanner/terms.txt', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// tira tamanhos ("5kg", "900ml") e repetidos: a pessoa fala "arroz", não "arroz 5 kg"
const nomes = [...new Set(termos.map((t) => t.replace(/\b\d+(?:[.,]\d+)?\s*(kg|g|l|ml)\b/gi, '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
const modelo = {
  interactionModel: {
    languageModel: {
      invocationName: 'mercado inteligente',
      intents: [
        { name: 'AMAZON.CancelIntent', samples: [] }, { name: 'AMAZON.HelpIntent', samples: [] }, { name: 'AMAZON.StopIntent', samples: [] },
        { name: 'AMAZON.YesIntent', samples: [] }, { name: 'AMAZON.NoIntent', samples: [] }, { name: 'AMAZON.FallbackIntent', samples: [] },
        { name: 'AddItemIntent', slots: [{ name: 'item', type: 'Mercadoria' }, { name: 'quantidade', type: 'AMAZON.NUMBER' }],
          samples: ['adicionar {item}', 'adicione {item}', 'adicionar {quantidade} {item}', 'adicione {quantidade} {item}', 'colocar {item} na lista', 'coloque {item} na lista',
            'coloque {quantidade} {item} na lista', 'anotar {item}', 'anote {item}', 'anote {quantidade} {item}', 'preciso de {item}', 'preciso de {quantidade} {item}', 'incluir {item}', 'inclua {item}'] },
        { name: 'RemoveItemIntent', slots: [{ name: 'item', type: 'Mercadoria' }], samples: ['remover {item}', 'remova {item}', 'tirar {item} da lista', 'tire {item} da lista', 'apagar {item}', 'apague {item}', 'excluir {item}', 'exclua {item}'] },
        { name: 'ReadListIntent', samples: ['o que tem na minha lista', 'o que tem na lista', 'ler minha lista', 'leia minha lista', 'ler a lista', 'leia a lista', 'o que falta comprar', 'qual é a minha lista'] },
        { name: 'ClearListIntent', samples: ['limpar a lista', 'limpe a lista', 'apagar a lista', 'apague a lista', 'esvaziar a lista', 'esvazie a lista'] },
        { name: 'LinkIntent', slots: [{ name: 'codigo', type: 'AMAZON.NUMBER' }], samples: ['vincular código {codigo}', 'vincule código {codigo}', 'vincular {codigo}', 'o código é {codigo}', 'código {codigo}'] },
      ],
      types: [{ name: 'Mercadoria', values: nomes.map((n) => ({ name: { value: n } })) }],
    },
  },
};
console.log(JSON.stringify(modelo, null, 2));
