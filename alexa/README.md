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

## Colocar no ar (você faz uma vez; precisa de conta gratuita na Cloudflare e na Amazon)

### 1. Worker (Cloudflare)

```bash
cd alexa/worker
npx wrangler login
npx wrangler kv namespace create LISTAS        # copie o id para wrangler.toml
npx wrangler secret put SKILL_SECRET           # invente um segredo longo; guarde para o passo 3
# em wrangler.toml, confira ALLOWED_ORIGIN (https://leandrobatissta.github.io)
npx wrangler deploy                            # mostra o endereço https://smart-market-lista.<conta>.workers.dev
```

### 2. Site

Em `docs/data/config.json` coloque o endereço do Worker e publique:

```json
{ "syncUrl": "https://smart-market-lista.SUACONTA.workers.dev" }
```

Com isso aparece, em **Minha lista**, o painel **Conectar a Alexa**.

### 3. Skill (conta de desenvolvedor Amazon, a mesma da sua Alexa)

1. Entre em <https://developer.amazon.com/alexa/console/ask> com o login da Amazon que usa na Alexa (criar a conta de desenvolvedor é gratuito).
2. **Create Skill** → nome *Mercado Inteligente* → idioma **Português (Brasil)** → tipo **Custom** → hospedagem **Alexa-hosted (Node.js)**.
3. Em **Build → JSON Editor**, cole o conteúdo de `skill/skill-package/interactionModels/custom/pt-BR.json` e **Save/Build**. (A invocação é *mercado inteligente*.)
4. Em **Code**, substitua `index.js` e `package.json` pelos de `skill/lambda/`, crie `falas.js` e `api.js` com o conteúdo dos arquivos de mesmo nome, e adicione as variáveis de ambiente **LISTA_URL** (endereço do Worker) e **SKILL_SECRET** (o mesmo segredo do passo 1). **Deploy**.
5. Em **Test**, ative o teste em *Development*. Pronto: ela já funciona nos aparelhos Alexa ligados à mesma conta Amazon (não precisa publicar na loja).

### 4. Ligar a Alexa ao site

No site, **Minha lista → Conectar a Alexa → Gerar código**. Fale: *"Alexa, abra mercado inteligente"* e depois *"vincular código"* e os 6 números.

## Frases

| Diga | Faz |
|---|---|
| "adicionar leite", "adicione 2 leite", "coloque pão na lista", "anote café", "preciso de ovos" | adiciona (soma se já existe) |
| "remover leite", "tire pão da lista" | remove |
| "o que tem na minha lista" | lê a lista |
| "limpar a lista" | pede confirmação ("sim"/"não") e apaga tudo |
| "vincular código 123456" | liga esta Alexa ao site |

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
