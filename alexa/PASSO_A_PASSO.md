# Passo a passo: colocar na sua Alexa

Resultado final: você fala **"Alexa, abrir mercado inteligente"** e depois **"adicionar leite"** ou **"o que tem na minha lista"**, e a mesma lista aparece no site.

Tempo estimado: 30 a 40 minutos na primeira vez. Custo: zero (contas gratuitas).

> **Entenda o desenho antes (2 minutos).** A lista de compras *nativa* da Alexa não pode ser lida por outros apps desde 2024. Por isso criamos uma **skill própria**, que guarda a lista num pequeno serviço gratuito (um *Worker* da Cloudflare). O site e a Alexa conversam com esse serviço. Ou seja: a lista do site e a da skill são **a mesma**, mas ela **não é** a lista de compras que aparece no app da Alexa.

```
Você fala ──► Alexa (skill) ──► Worker (guarda a lista) ◄── Site
```

## O que você precisa

| Item | Para quê |
|---|---|
| A conta Amazon que você usa na Alexa (e-mail e senha) | cadastrar a skill; ela só funciona nos aparelhos dessa conta |
| Uma conta gratuita na Cloudflare | hospedar o Worker |
| Node.js instalado no Mac (`node -v` mostra a versão; se não tiver, `brew install node`) | rodar o script de instalação |
| Este repositório baixado no Mac | os arquivos da skill |

---

## PARTE A. Colocar o Worker no ar (Cloudflare)

### A1. Criar a conta na Cloudflare
1. Abra <https://dash.cloudflare.com/sign-up> e crie a conta (e-mail e senha). Confirme o e-mail que eles enviam.
2. Não precisa cadastrar domínio nem cartão.

### A2. Rodar o script
No Terminal:

```bash
cd ~/Desktop/repos/pessoal/smart-market-scanner
./alexa/deploy-worker.sh
```

O que vai acontecer:
1. Abre o navegador pedindo para **autorizar o Wrangler** na Cloudflare. Clique em **Allow**.
2. O script cria o armazenamento da lista, gera um **segredo** aleatório, publica o Worker e aponta o site para ele.
3. No final imprime algo assim (os valores serão os seus):

```
  LISTA_URL    = https://smart-market-lista.suaconta.workers.dev
  SKILL_SECRET = 3f9a...c1d2
```

**Guarde esses dois valores**, você vai colá-los na skill (parte B). O segredo também fica salvo em `alexa/worker/.segredo-da-skill` (arquivo que não vai ao GitHub).

> Quer só ver o que o script faria, sem alterar nada? Rode `./alexa/deploy-worker.sh --dry-run`.

### A3. Conferir que o Worker respondeu
```bash
curl -s https://SEU-ENDERECO.workers.dev/list
```
A resposta correta é `{"error":"token inválido"}`: significa que ele está no ar e protegido.

### A4. Publicar a configuração do site
O script gravou o endereço em `docs/data/config.json`. Para o site publicado no GitHub Pages enxergar, faça commit e push:

```bash
git add docs/data/config.json && git commit -m "config: endereço do Worker da lista" && git push
```
(No site local, `http://localhost:8080`, a configuração já vale na hora.)

> Se o endereço do seu site no Pages for diferente de `https://leandrobatissta.github.io`, edite `ALLOWED_ORIGIN` em `alexa/worker/wrangler.toml` e rode o script de novo.

---

## PARTE B. Cadastrar a skill na Amazon

### B1. Entrar no console da Alexa
1. Abra <https://developer.amazon.com/alexa/console/ask>.
2. Entre com o **mesmo e-mail e senha da sua Alexa**. Isso é essencial: a skill de teste só aparece nos aparelhos dessa conta.
3. Se for o primeiro acesso, aceite os termos e preencha o cadastro de desenvolvedor (gratuito; pode pedir nome, país e telefone).

### B2. Criar a skill
1. Clique em **Create Skill**.
2. **Skill name:** `Mercado Inteligente`
3. **Primary locale:** `Portuguese (BR)` → **Next**.
4. **Type of experience:** `Other` → **Model:** `Custom` → **Hosting service:** `Alexa-hosted (Node.js)` → **Next**.
5. **Template:** `Start from Scratch` → **Next** → **Create skill**.
6. Espere cerca de um minuto, até abrir a tela da skill.

### B3. Colar o modelo de voz (as frases que ela entende)
1. Menu da esquerda: **Build → Interaction Model → JSON Editor**.
2. **Apague tudo** o que estiver na caixa.
3. Abra no Mac o arquivo `alexa/skill/skill-package/interactionModels/custom/pt-BR.json`, copie **todo** o conteúdo e cole na caixa.
4. Clique em **Save Model** e depois em **Build Model**. Espere a mensagem **Full Build Successful**.

### B4. Colar o código
1. Clique na aba **Code** (no topo).
2. Na lista de arquivos à esquerda, abra a pasta `lambda`.
3. **Substitua** o conteúdo destes dois arquivos pelos do repositório (em `alexa/skill/lambda/`):
   - `index.js`
   - `package.json`  (ele tem `"type": "module"`; não apague essa linha)
4. Crie **dois arquivos novos** (botão de **criar arquivo** na pasta `lambda`) e cole o conteúdo dos de mesmo nome:
   - `falas.js`
   - `api.js`
5. Crie **mais um arquivo**, `config.js`, com **os seus dois valores** da parte A2:

```js
export const LISTA_URL = 'https://smart-market-lista.suaconta.workers.dev';
export const SKILL_SECRET = 'o-segredo-impresso-pelo-script';
```
(O modelo está em `alexa/skill/lambda/config.example.js`. Este `config.js` fica **só** no editor da Alexa, nunca no GitHub.)

6. Clique em **Deploy** (canto superior direito do editor). Espere **Deployment successful**.

> Se o editor tiver uma área de **Environment Variables**, pode usar `LISTA_URL` e `SKILL_SECRET` ali em vez do `config.js`. Os dois jeitos funcionam.

### B5. Testar no próprio console
1. Aba **Test**. No topo, mude **Skill testing is enabled in** para **Development**.
2. Na caixa de texto digite: `abrir mercado inteligente`.
3. Ela deve responder pedindo para vincular ao site. É o esperado: o próximo passo faz isso.

---

## PARTE C. Ligar a skill ao site

1. Abra o site (`http://localhost:8080` ou o endereço do Pages) e entre.
2. Em **Minha lista**, abra **Conectar a Alexa** e clique em **Gerar código de ligação**. Aparece um número de 6 dígitos (vale 10 minutos).
3. No **Test** do console (ou falando com a Alexa), diga:
   - `abrir mercado inteligente`
   - `vincular código` e os seis números (no teste por texto: `vincular código 123456`)
4. A Alexa responde **"Vinculado!"** e o site mostra **"Alexa conectada ✓"**.

Pronto. Agora teste:

- `adicionar leite` → o item aparece no site em até 20 segundos.
- `adicionar duas caixas de leite` ou `adicionar 2 leite`
- `o que tem na minha lista` → ela lê os itens.

---

## PARTE D. Usar na sua Echo (o aparelho)

Com a skill em modo **Development** e o aparelho na **mesma conta Amazon**, é só falar:

> **"Alexa, abrir mercado inteligente"**

Para pedir direto, sem abrir antes:

> "Alexa, peça ao mercado inteligente para adicionar leite"
> "Alexa, pergunte ao mercado inteligente o que tem na lista"

Dica: o idioma do aparelho precisa ser **Português (Brasil)**. Confira no app Alexa: *Dispositivos → seu aparelho → Configurações → Idioma*.

Para ver a skill instalada: app Alexa → *Mais → Skills e jogos → Suas skills → Desenvolvimento*.

---

## Frases que ela entende

| Diga | Faz |
|---|---|
| "adicionar leite", "adicione 2 leite", "coloque pão na lista", "anote café", "preciso de ovos", "incluir arroz" | adiciona o item (se já existe, soma a quantidade) |
| "o que tem na minha lista", "ler minha lista", "o que falta comprar" | lê os itens da lista |
| "vincular código 123456" | liga a Alexa ao site (uma vez só) |
| "ajuda" | lista o que ela faz |

(Remover item e limpar a lista ficam para uma próxima etapa.)

---

## Se algo não funcionar

| Sintoma | Causa provável e o que fazer |
|---|---|
| A Alexa diz que não encontrou a skill | Aparelho em outra conta Amazon, ou idioma diferente de pt-BR. Confira a conta e o idioma. Confira também se, no **Test**, está em *Development*. |
| "Esse código não é válido ou já venceu" | O código vale 10 minutos e só funciona uma vez. Gere outro no site. Depois de 5 erros ela bloqueia por alguns minutos. |
| "Não consegui falar com a sua lista agora" | O `LISTA_URL` ou o `SKILL_SECRET` está errado no `config.js`. Rode `./alexa/deploy-worker.sh` de novo (ele reaproveita o segredo) e confira os dois valores. |
| Ela entendeu o item errado | Fale itens simples e curtos ("leite", "pão", "sabonete"). O modelo conhece os itens da lista de termos do site. |
| O site não mostra **Conectar a Alexa** | `docs/data/config.json` está com `"syncUrl": ""` ou ainda não foi publicado (veja A4). |
| O site mostra "A ligação com a lista expirou" | Gere um novo código no site e vincule de novo. |
| Erro de CORS no navegador | O `ALLOWED_ORIGIN` em `alexa/worker/wrangler.toml` não é o endereço do seu site. Corrija e rode o script de novo. |
| A skill parou depois de eu editar o código | Clique em **Deploy** de novo e espere **Deployment successful**. Veja os erros na aba **CloudWatch Logs** (link no editor de código). |

---

## Segurança, em poucas palavras

- O **SKILL_SECRET** é a senha entre a skill e o Worker. Não publique. Ele fica no seu `config.js` (só no editor da Alexa) e em `alexa/worker/.segredo-da-skill` (ignorado pelo Git).
- O navegador guarda um **token** da sua lista no `localStorage`. Quem tiver esse token acessa a lista; trate como senha. O botão **Desconectar neste aparelho** apaga o token.
- O Worker guarda só nomes e quantidades de itens. Nada de senha, e-mail ou dados de pagamento.

## Atualizar depois

- **Mudou o modelo de voz** (`gen-model.mjs`): rode `node alexa/skill/gen-model.mjs > alexa/skill/skill-package/interactionModels/custom/pt-BR.json`, cole de novo no **JSON Editor** (B3) e faça **Build Model**.
- **Mudou o código** da skill: cole os arquivos alterados no editor (B4) e clique em **Deploy**.
- **Mudou o Worker**: rode `./alexa/deploy-worker.sh` de novo.

## Testar tudo sem Alexa nem Cloudflare

```bash
node alexa/worker/dev-server.mjs   # Worker local em http://localhost:8787 (segredo "dev-secret")
# em docs/data/config.json use "syncUrl": "http://localhost:8787" e abra http://localhost:8080
node --test alexa/worker/test/*.test.js alexa/skill/test/*.test.js tests/js/*.test.js
```
(Para o teste com o SDK real da Alexa, rode antes `cd alexa/skill/lambda && npm install`.)
