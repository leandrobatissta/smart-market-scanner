# Smart Market Scanner

Compara o preço da sua **lista de compras** entre supermercados de Santa Catarina. Os preços são **coletados automaticamente** (você não digita preço nenhum) e o site roda no **GitHub Pages**.

- **Lista:** digite os itens, ou importe por **planilha (XLSX), CSV, PDF, TXT ou foto** (a leitura acontece no seu navegador). Ao importar escolha **adicionar à lista atual** ou **substituir**; antes de aplicar você confere e corrige os itens lidos.
- **Comparação:** total por mercado, itens sem preço e a cesta mais barata misturando mercados. Cada produto mostra link, preço por kg/litro e se está em oferta.
- **Privacidade:** a lista fica só no seu navegador.

## Mercados

| Mercado | Como coleta | Situação |
|---|---|---|
| Giassi | API pública de busca da loja virtual (VTEX) | funcionando |
| Fort Atacadista | sitemap + dado estruturado (JSON-LD) das páginas de produto | funcionando |
| Bistek | VTEX, mas o `robots.txt` proíbe a busca automatizada | **pulado de propósito** (respeitamos o robots.txt) |
| Angeloni | plataforma própria, sem API; o sitemap público só lista eletro | a investigar |
| Super Imperatriz | não achei loja online com preço | a investigar |

O coletor respeita o `robots.txt`, se identifica (`smart-market-scanner/1.0`), faz um pedido por vez e espera entre eles. Os preços são os da **loja virtual** e podem diferir das lojas físicas; podem depender do CEP.

## Rodar localmente (Docker)

```bash
git clone git@github.com:leandrobatissta/smart-market-scanner.git
cd smart-market-scanner
./setup.sh        # instala o que faltar (Docker/Compose/Colima), constrói, testa, coleta e sobe o site
```

O `setup.sh` funciona em macOS (Homebrew), Linux (apt/dnf/pacman) e no Windows via WSL2. Depois: site em <http://localhost:8080>.

| Comando | O que faz |
|---|---|
| `make up` / `make down` | sobe / para o coletor e o site |
| `make scan` | coleta completa uma vez (alguns minutos) |
| `make scan-fast` | coleta rápida (15 termos) |
| `make test` | testes do coletor (Python) e da lista/comparação (JavaScript) |
| `make logs` | acompanha o coletor |

## GitHub Pages

O workflow `.github/workflows/pages.yml` roda os testes, coleta os preços e publica `docs/` a cada 6 horas (e a cada push). Em **Settings → Pages**, escolha **Source: GitHub Actions**.

## O que entra no catálogo

Só os termos de `scanner/terms.txt` (cesta básica, higiene, limpeza, bebidas…). Para incluir um produto, adicione uma linha lá. Não baixamos o catálogo inteiro dos mercados de propósito.

## Próximos passos / ideias

- Separar **preço normal**, **oferta** e **preço de clube/cartão**; guardar data e origem de cada preço (histórico).
- Outras redes: Koch, Brasil Atacadista, Angeloni (cada site precisa de investigação).
- Considerar frete, pedido mínimo e distância na recomendação de onde comprar.
- Fontes complementares: notas fiscais (Menor Preço Brasil / SEF-SC), encartes, contribuição de usuários.
