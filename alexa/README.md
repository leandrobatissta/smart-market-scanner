# Alexa: lista de compras por voz

A lista de compras nativa da Alexa **não é acessível** por aplicativos de terceiros desde 1º/07/2024 (a Amazon desligou a API). Por isso a skill **Mercado Inteligente** mantém uma lista **própria**, que o site também lê e escreve, nos dois sentidos:

```
Alexa (skill)  ──►  Cloudflare Worker (lista, grátis)  ◄──  site (navegador)
   "adicionar leite"      guarda a lista                        mostra e edita
```

- **Site ⇄ Worker:** o navegador cria um token aleatório e só o **hash** dele fica no servidor. Cada usuário do site tem a sua lista.
- **Alexa ⇄ Worker:** a skill usa um segredo compartilhado e o id do usuário da Alexa. O **pareamento** é por código de 6 números (vale 10 min, uso único, máx. 5 erros).
- A lista junta as duas pontas item a item: vale a mudança mais recente; apagados viram "tombstones" por 30 dias.

## O que cada peça faz

| Pasta | O quê |
|---|---|
| `worker/` | Serviço da lista (Cloudflare Worker + KV). `dev-server.mjs` roda o mesmo código localmente para testar. |
| `skill/lambda/` | Código da skill (falas em `falas.js`, cliente do Worker em `api.js`, ligação ao SDK em `index.js`). |
| `skill/skill-package/` | Manifesto e modelo de voz **pt-BR** (frases e os itens do `scanner/terms.txt`). Gere de novo com `node skill/gen-model.mjs`. |
| `../docs/lib/lista-sync.js` | Regras de junção da lista (usadas pelo site e pelo Worker). |

## Colocar no ar

**Siga o [PASSO_A_PASSO.md](PASSO_A_PASSO.md)** (Cloudflare, console da Alexa, ligação ao site e uso na Echo, com solução de problemas). Resumo:

1. `./alexa/deploy-worker.sh` publica o Worker e imprime `LISTA_URL` e `SKILL_SECRET`.
2. No [console da Alexa](https://developer.amazon.com/alexa/console/ask): criar a skill (Custom, Alexa-hosted Node.js, pt-BR), colar o modelo de voz e os arquivos de `skill/lambda/` mais um `config.js` com os dois valores.
3. No site: **Minha lista → Conectar a Alexa → Gerar código**, e dizer *"vincular código ..."* para a Alexa.

## Frases (versão simples)

| Diga | Faz |
|---|---|
| "adicionar leite", "adicione 2 leite", "coloque pão na lista", "anote café", "preciso de ovos" | adiciona (soma se já existe) |
| "o que tem na minha lista" | lê a lista |
| "vincular código 123456" | liga esta Alexa ao site (uma vez) |

Remover item e limpar a lista ainda **não** estão na skill (o Worker já tem as rotas, é só ligar depois).

## Testar sem Alexa nem Cloudflare

```bash
node alexa/worker/dev-server.mjs                       # Worker local em http://localhost:8787 (segredo "dev-secret")
# coloque "syncUrl": "http://localhost:8787" em docs/data/config.json e abra o site
node --test alexa/worker/test/*.test.js alexa/skill/test/*.test.js tests/js/*.test.js
```

## Limites e cuidados

- É uma skill **própria**: não mexe na lista de compras nativa do app Alexa.
- O Worker só guarda nomes e quantidades. Quem tiver o token do navegador acessa aquela lista; trate-o como senha (fica no `localStorage` do aparelho).
- O plano gratuito da Cloudflare cobre uso pessoal com folga; a skill em modo desenvolvimento só funciona para a sua conta.
