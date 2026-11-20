# Smart Market Scanner

Compara o preço da sua **lista de compras** entre supermercados de Santa Catarina. Os preços são **coletados automaticamente** (você não digita preço nenhum) e o site roda no **GitHub Pages** ou localmente com Docker.

## O que o site faz

O site tem abas, uma seção por vez:

| Aba | Para quê |
|---|---|
| **Minha lista** | Digite itens (com **busca inteligente**: sugestões enquanto digita, mesmo com erro de digitação, sem acento e com sinônimos como "refri" ou "pasta de dente") ou importe **cesta básica, planilha (XLSX), CSV, PDF, TXT ou foto** (lido no navegador). Ao importar escolha **adicionar à lista atual** ou **substituir**; antes de aplicar você confere e corrige. Ao lado de cada item aparece **onde ele está mais barato**. |
| **Comparar** | Total por mercado, tabela por categoria, itens sem preço e a cesta mais barata misturando mercados. |
| **Lista consolidada** | Sugestão de compra: **tudo em 1 mercado**, ou dividida em **até 2 ou 3 mercados** (cada item no mais barato da opção). Dá para **compartilhar**: WhatsApp, e-mail, copiar texto, baixar TXT/planilha, **imagem** (copiar ou baixar) e imprimir/PDF. |
| **Por mercado** | Sua lista dentro de um mercado, agrupada por categoria, com link dos produtos. |
| **Promoções** | Cards das ofertas encontradas (preço de oferta abaixo do normal, ou página de ofertas do mercado). |
| **Encartes** | Folhetos vigentes de cada rede (Imperatriz, Giassi, Angeloni, Bistek, Fort e Komprão primeiro) com capa, validade e link para abrir. Atualizados a cada coleta. |
| **Mercados** | Quais mercados estão coletados, quantos produtos e link do site. |

**Item novo:** ao adicionar um item que não está no catálogo, ele é procurado **em todos os mercados cadastrados, em segundo plano** (um thread por mercado, com o andamento na tela, sem travar). Rodando localmente isso é imediato (API do Docker); no GitHub Pages aparece o link **"pedir inclusão"**, que abre uma issue e entra na coleta seguinte.

A lista fica só no seu navegador.

## Mercados

| Mercado | Como coleta | Situação |
|---|---|---|
| Giassi | API pública de busca da loja virtual (VTEX) | funcionando |
| Angeloni (Super) | API pública de busca da loja virtual (VTEX), busca por caminho (o robots.txt proíbe `?ft=`) | funcionando |
| Bistek | páginas de categoria e a página de ofertas ("Ofertacos da quinzena"), com dado estruturado; a busca/API são proibidas pelo robots.txt e não são usadas | funcionando |
| Fort Atacadista | sitemap + dado estruturado (JSON-LD) das páginas de produto | funcionando |
| Super Imperatriz | o site é institucional e o encarte digital fica no app Super Clube (só para membros) | **sem fonte pública de preços** |

O coletor **respeita o robots.txt** (com curingas), se identifica (`smart-market-scanner/1.0`), faz um pedido por vez em cada mercado e espera entre eles; os mercados rodam em paralelo. Os preços são os da **loja virtual** e podem diferir das lojas físicas ou depender do CEP.

### Encartes

A aba **Encartes** usa a página de cada rede no **Tiendeo** (Florianópolis): título, validade e capa vêm do dado estruturado da página, que o robots.txt permite ler. As páginas dos folhetos (`/Catalogos/`) são proibidas ao robô, então só aparecem como **link** para a pessoa abrir.

Os **preços dentro do encarte não são lidos** (exigiria OCR de imagens e a autorização das fontes); ficam como próximo passo. Outras fontes avaliadas: Preços Online (só Fort e Komprão, em imagens) e a página de folhetos do Fort (depende de escolher loja).

### Data Market (API comercial), avaliado em 20/11/2026

Conferido com uma chave de teste (`scanner/datamarket_check.py`): das **29 lojas monitoradas em Santa Catarina** (todas de e-commerce) existem Giassi, Bistek e Angeloni (que já coletamos direto), mais Hippo, Super Koch, Hiper Select, Super Chico e outras de Florianópolis e região. **Não há Super Imperatriz nem Fort Atacadista.** Por isso ele não resolve o Imperatriz; poderia, no futuro, acrescentar Hippo, Koch e Hiper Select, mas é pago depois dos 14 dias de teste.

## Rodar localmente (Docker)

```bash
git clone git@github.com:leandrobatissta/smart-market-scanner.git
cd smart-market-scanner
./deploy.sh          # sobe tudo; se faltar Docker/Compose, instala (setup.sh)
```

`./setup.sh` funciona em macOS (Homebrew), Linux (apt/dnf/pacman) e no Windows via WSL2. Site em <http://localhost:8080>.

| Comando | O que faz |
|---|---|
| `./deploy.sh` ou `up` | build, testes, coletor + API + site, e espera ficar saudável (`--fresh` reconstrói do zero, `--skip-tests` pula os testes) |
| `./deploy.sh status` | containers, saúde e idade dos preços |
| `./deploy.sh scan` | coleta completa **em segundo plano** (não trava o terminal) |
| `./deploy.sh logs [serviço]` | acompanha os logs |
| `./deploy.sh restart` / `down` | reinicia / para |
| `./deploy.sh pages` | publica no GitHub Pages (push, ativa o Pages e dispara a rotina) |
| `make test` | testes do coletor (Python) e da lista/comparação/compartilhar (JavaScript) |

## GitHub Pages

O site publicado no Pages é **estático**: não precisa de servidor. Ficam só no modo local (Docker) o botão **Atualizar base** e a busca instantânea de item novo; no Pages o item novo vira o link "pedir inclusão" e a base se atualiza sozinha 2 vezes por dia.

O workflow `.github/workflows/pages.yml` roda os testes, coleta os preços e os encartes e publica `docs/` **2 vezes por dia** (coleta completa de ~25 min) e a cada push (que reaproveita os últimos preços guardados em cache, sem refazer a coleta). Repositório público tem minutos de Actions ilimitados; em repositório privado, 2 coletas por dia ficam dentro do plano gratuito. `./deploy.sh pages` faz o push e ativa o Pages; ou, à mão, em **Settings → Pages**, escolha **Source: GitHub Actions**.

O botão **"pedir inclusão"** abre uma issue "Termo: item" com o rótulo `novo-termo`; o workflow `add-term.yml` (só para issues do dono do repositório) valida o termo, acrescenta em `scanner/user_terms.txt` e dispara nova publicação.

## Base de itens e busca

A base de itens vem dos termos de `scanner/terms.txt` (por categoria) e dos itens pedidos; cada item guarda quantos produtos foram achados, o menor preço e os mercados que o têm. A busca (`docs/lib/search.js`) tolera erro de digitação, ignora acento, aceita prefixo e usa sinônimos; o mesmo mecanismo faz o casamento dos itens da lista com os produtos.

## O que entra no catálogo

Os termos de `scanner/terms.txt` (cesta básica, higiene, limpeza, bebidas… organizados por categoria com `## Categoria`) mais os itens pedidos em `scanner/user_terms.txt`. Não baixamos o catálogo inteiro dos mercados de propósito.

## Próximos passos / ideias

- Separar **preço normal**, **oferta** e **preço de clube/cartão**; guardar data e origem de cada preço (histórico).
- Outras redes de Florianópolis: Koch, Brasil Atacadista, Komprão (cada site precisa de investigação).
- Considerar frete, pedido mínimo e distância na recomendação de onde comprar.
- Fontes complementares: encartes (com OCR e autorização), notas fiscais (Menor Preço Brasil / SEF-SC).
