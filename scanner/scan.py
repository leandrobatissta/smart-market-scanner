"""Coletor de preços: busca cada termo de terms.txt na loja virtual de cada mercado (API pública VTEX) e grava docs/data/prices.json.

Respeita o robots.txt de cada site (mercado que proíbe a busca é pulado, com o motivo no JSON), usa um pedido por vez e espera entre eles.
Uso: python scan.py --out ../docs/data/prices.json [--limit-terms 10]
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from robots import can_fetch
from encarte_pdf import categoria_pelo_nome, em_produtos as pdf_em_produtos, extrair_texto, ler_ofertas as pdf_ler_ofertas, validade as pdf_validade
from encartes import current as current_encartes, parse_catalog_page
from bistek import parse_itemlist, select_category_urls, sitemap_urls
from forte import parse_product_page, product_urls, select_urls
from prices import vtex_product

HERE = Path(__file__).parent
SEARCH_PATH = "/api/catalog_system/pub/products/search"


def load_terms(path: Path) -> list[str]:
    return [t for t, _ in load_terms_with_category(path)]


USER_TERMS = HERE / "user_terms.txt"


def load_all_terms() -> list[tuple[str, str]]:
    """terms.txt + os itens pedidos pelos usuários (user_terms.txt, categoria 'Pedidos'); repetidos saem."""
    pairs = load_terms_with_category(HERE / "terms.txt")
    seen = {t for t, _ in pairs}
    if USER_TERMS.exists():
        for t in (l.strip() for l in USER_TERMS.read_text(encoding="utf-8").splitlines()):
            if t and not t.startswith("#") and t not in seen:
                pairs.append((t, "Pedidos")); seen.add(t)
    return pairs


def load_terms_with_category(path: Path) -> list[tuple[str, str]]:
    """Termos com a categoria da seção (`## Categoria`) em que estão; antes da primeira seção, 'Outros'."""
    out, cat = [], "Outros"
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("##"):
            cat = line.lstrip("#").strip() or "Outros"
        elif line and not line.startswith("#"):
            out.append((line, cat))
    return out


def allowed(site: str, path: str, ua: str, robots_text: Optional[str]) -> bool:
    """O robots.txt do site permite buscar `path` (com a query)? Sem robots.txt legível, vale permitido."""
    return can_fetch(robots_text, ua, path)


def decode_body(raw: bytes) -> str:
    """Corpo da resposta como texto; alguns sites (Bistek) mandam gzip mesmo sem o cliente pedir."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


_CACHE: dict[str, tuple[float, Optional[str]]] = {}


def http_text_cached(url: str, ua: str, timeout: int = 20, ttl: int = 6 * 3600) -> Optional[str]:
    """Igual ao http_text, mas guarda a resposta por `ttl` segundos (sitemaps grandes)."""
    hit = _CACHE.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    body = http_text(url, ua, timeout)
    if body is not None:
        _CACHE[url] = (time.time(), body)
    return body


def http_text(url: str, ua: str, timeout: int = 20) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
        return decode_body(raw)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def search_path(term: str, limit: int) -> str:
    """Busca pelo termo no CAMINHO (não em ?ft=, que alguns robots.txt proíbem). O espaço vira %20 (a VTEX recusa "+")."""
    return f"{SEARCH_PATH}/{urllib.parse.quote(term, safe='')}?_from=0&_to={max(limit - 1, 0)}"


def search(site: str, term: str, limit: int, ua: str) -> list[dict[str, Any]]:
    body = http_text(f"{site}{search_path(term, limit)}", ua)
    if body is None:
        raise RuntimeError("sem resposta")
    data = json.loads(body)
    if not isinstance(data, list):
        raise RuntimeError("resposta inesperada")
    return data


def scan_forte(store: dict[str, Any], terms: list[str], cfg: dict[str, Any], progress: Optional[Callable[[int, int], None]] = None) -> dict[str, Any]:
    """Sitemap -> páginas de produto escolhidas pelo nome -> preço em JSON-LD. Sem API, mas dentro do que o robots.txt permite (/produtos/)."""
    ua, site = cfg["userAgent"], store["site"]
    info = {"id": store["id"], "name": store["name"], "site": site, "status": "ok", "reason": "", "products": 0}
    robots = http_text(site + "/robots.txt", ua)
    sample = site + "/produtos/1/x"
    if not allowed(site, "/produtos/1/x", ua, robots):
        info.update(status="bloqueado", reason="o robots.txt do site não permite ler as páginas de produto")
        return {"info": info, "products": []}
    sitemap = http_text_cached(site + "/sitemap.xml", ua, timeout=60)
    urls = product_urls(sitemap) if sitemap else []
    if not urls:
        info.update(status="falhou", reason="sitemap indisponível")
        return {"info": info, "products": []}
    seen: dict[str, dict[str, Any]] = {}
    fetched: set[str] = set()
    failures = 0
    for i, term in enumerate(terms):
        if progress:
            progress(i, len(terms))
        for url in select_urls(urls, term, cfg.get("forteLimit", 5)):
            if url in fetched:
                continue
            fetched.add(url)
            html = http_text(url, ua)
            time.sleep(cfg["delaySeconds"])
            if html is None:
                failures += 1
                continue
            p = parse_product_page(html, url, store["id"], term)
            if p and p["id"] not in seen:
                seen[p["id"]] = p
    if progress:
        progress(len(terms), len(terms))
    info["products"] = len(seen)
    if failures:
        info["reason"] = f"{failures} página(s) sem resposta"
    return {"info": info, "products": list(seen.values())}


def scan_bistek(store: dict[str, Any], terms: list[str], cfg: dict[str, Any], progress: Optional[Callable[[int, int], None]] = None) -> dict[str, Any]:
    """Páginas de categoria (permitidas pelo robots.txt) + página de ofertas; a busca e a API ficam de fora, como o robots.txt pede."""
    ua, site = cfg["userAgent"], store["site"]
    info = {"id": store["id"], "name": store["name"], "site": site, "status": "ok", "reason": "", "products": 0}
    robots = http_text(site + "/robots.txt", ua)
    if not allowed(site, "/mercearia/cafes?page=2", ua, robots):
        info.update(status="bloqueado", reason="o robots.txt do site não permite ler as páginas de categoria")
        return {"info": info, "products": []}
    urls: list[str] = []
    for part in ("category-0", "subcategory-0"):
        xml = http_text_cached(f"{site}/sitemap/{part}.xml", ua, timeout=40)
        urls += sitemap_urls(xml) if xml else []
    seen: dict[str, dict[str, Any]] = {}
    failures = 0

    def page(url: str, term: str, source: str = "", promo: bool = False) -> None:
        nonlocal failures
        if not allowed(site, re.sub(r"^https?://[^/]+", "", url), ua, robots):
            return
        html = http_text(url, ua)
        time.sleep(cfg["delaySeconds"])
        if html is None:
            failures += 1
            return
        for p in parse_itemlist(html, store["id"], term, source, promo):
            seen.setdefault(p["id"], p)

    page(site + "/ofertacos-da-quinzena", "ofertas", "ofertacos-da-quinzena", True)
    page(site + "/ofertacos-da-quinzena?page=2", "ofertas", "ofertacos-da-quinzena", True)
    done: set[str] = set()
    for i, term in enumerate(terms):
        if progress:
            progress(i, len(terms))
        for cat in select_category_urls(urls, term, cfg.get("bistekCategories", 2)):
            for n in (1, 2):
                u = cat if n == 1 else f"{cat}?page={n}"
                if u in done:
                    continue
                done.add(u)
                page(u, term)
    if not urls:
        info.update(status="falhou", reason="sitemap indisponível")
        return {"info": info, "products": []}
    if progress:
        progress(len(terms), len(terms))
    info["products"] = len(seen)
    if failures:
        info["reason"] = f"{failures} página(s) sem resposta"
    return {"info": info, "products": list(seen.values())}


def scan_store(store: dict[str, Any], terms: list[str], cfg: dict[str, Any], progress: Optional[Callable[[int, int], None]] = None) -> dict[str, Any]:
    if store.get("kind") == "bistek":
        return scan_bistek(store, terms, cfg, progress)
    if store.get("kind") == "none":
        info = {"id": store["id"], "name": store["name"], "site": store["site"], "status": "indisponivel", "reason": store.get("reason", "sem fonte pública de preços"), "products": 0}
        return {"info": info, "products": []}
    if store.get("kind") == "forte":
        return scan_forte(store, terms, cfg, progress)
    return scan_vtex(store, terms, cfg, progress)


def scan_vtex(store: dict[str, Any], terms: list[str], cfg: dict[str, Any], progress: Optional[Callable[[int, int], None]] = None) -> dict[str, Any]:
    ua, site = cfg["userAgent"], store["site"]
    info = {"id": store["id"], "name": store["name"], "site": site, "status": "ok", "reason": "", "products": 0}
    robots = http_text(site + "/robots.txt", ua)
    if not allowed(site, search_path("arroz", 12), ua, robots):
        info.update(status="bloqueado", reason="o robots.txt do site não permite a busca automatizada")
        return {"info": info, "products": []}
    seen: dict[str, dict[str, Any]] = {}
    failures = 0
    for i, term in enumerate(terms):
        if progress:
            progress(i, len(terms))
        try:
            for raw in search(site, term, cfg["perTermLimit"], ua):
                p = vtex_product(store["id"], term, raw)
                if p and p["id"] not in seen:
                    seen[p["id"]] = p
        except (RuntimeError, ValueError, json.JSONDecodeError) as e:
            failures += 1
            print(f"aviso: {store['id']} / {term}: {e}", file=sys.stderr)
            if failures >= 8 and not seen:
                info.update(status="falhou", reason="o site não respondeu")
                return {"info": info, "products": []}
        time.sleep(cfg["delaySeconds"])
    if progress:
        progress(len(terms), len(terms))
    info["products"] = len(seen)
    if failures:
        info["reason"] = f"{failures} termo(s) sem resposta"
    return {"info": info, "products": list(seen.values())}


def collect_encartes(cfg: dict[str, Any], today: Optional[date] = None) -> dict[str, Any]:
    """Encartes vigentes de cada rede (página da rede no Tiendeo, em paralelo). Falha de uma rede não derruba as outras."""
    ua = cfg["userAgent"]
    today = today or date.today()
    host = "https://www.tiendeo.com.br"
    robots = http_text(host + "/robots.txt", ua)

    def one(e: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        info = {"store": e["store"], "name": e["name"], "status": "ok", "count": 0, "reason": "", "links": [l for l in e.get("links", []) if str(l.get("url", "")).startswith("https://")]}
        for url in e["urls"]:
            path = url.replace(host, "")
            if not allowed(host, path, ua, robots):
                info.update(status="bloqueado", reason="robots.txt não permite")
                continue
            html = http_text(url, ua)
            if not html:
                info.update(status="falhou", reason="sem resposta")
                continue
            found = current_encartes(parse_catalog_page(html, e["store"], url), today)
            if found:
                info.update(status="ok", count=len(found), reason="")
                return info, found
            info.update(status="ok", reason="sem encartes vigentes")
        return info, []

    with ThreadPoolExecutor(max_workers=max(1, len(cfg.get("encartes", [])))) as pool:
        results = list(pool.map(one, cfg.get("encartes", [])))
    items = [i for _, found in results for i in found]
    return {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "Tiendeo (página de cada rede, Florianópolis)", "stores": [r[0] for r in results], "items": items}


def write_encartes(cfg: dict[str, Any], folder: Path) -> None:
    """Grava encartes.json ao lado dos preços; os encartes não podem derrubar a coleta de preços."""
    try:
        enc = collect_encartes(cfg)
        enc_out = folder / "encartes.json"
        folder.mkdir(parents=True, exist_ok=True)
        enc_tmp = enc_out.with_suffix(".tmp")
        enc_tmp.write_text(json.dumps(enc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        enc_tmp.replace(enc_out)
        print(f"ok: {len(enc['items'])} encartes -> {enc_out}")
    except Exception as e:
        print(f"aviso: encartes: {e}", file=sys.stderr)


def http_bytes(url: str, ua: str, timeout: int = 90) -> Optional[bytes]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
        return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def collect_pdf_offers(cfg: dict[str, Any], pairs: list[tuple[str, str]], today: Optional[date] = None) -> list[dict[str, Any]]:
    """Ofertas dos encartes em PDF com texto (hoje o semanal do Angeloni). PDF fora do ar, sem validade ou já vencido: nenhuma oferta, sem derrubar a coleta."""
    today = today or date.today()
    categoria = categoria_pelo_nome(pairs)
    out: list[dict[str, Any]] = []
    for src in cfg.get("pdfs", []):
        try:
            data = http_bytes(src["url"], cfg["userAgent"])
            if not data or data[:4] != b"%PDF":
                print(f"aviso: PDF {src['name']} indisponível", file=sys.stderr)
                continue
            texto = extrair_texto(data)
            val = pdf_validade(texto)
            if not val or val[1] < today.isoformat():
                print(f"aviso: PDF {src['name']} sem validade ou vencido", file=sys.stderr)
                continue
            produtos = pdf_em_produtos(pdf_ler_ofertas(texto), src["store"], val[1], src["url"], categoria)
            print(f"  {src['name']}: {len(produtos)} ofertas válidas até {val[1]}", flush=True)
            out.extend(produtos)
        except Exception as e:  # um PDF ruim não derruba a coleta
            print(f"aviso: PDF {src.get('name')}: {e}", file=sys.stderr)
    return out


def run_scan(cfg: dict[str, Any], pairs: list[tuple[str, str]], selected: list[dict[str, Any]], on_progress: Optional[Callable[[str, int, int], None]] = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Coleta os mercados em paralelo (um thread por mercado, cada um com 1 pedido por vez). `on_progress(id_do_mercado, feitos, total)` informa o andamento."""
    terms = [t for t, _ in pairs]
    category_of = dict(pairs)
    results: dict[str, dict[str, Any]] = {}

    def work(store: dict[str, Any]) -> None:
        print(f"{store['name']}: {len(terms)} termos…", flush=True)
        cb = (lambda done, total, sid=store["id"]: on_progress(sid, done, total)) if on_progress else None
        try:
            results[store["id"]] = scan_store(store, terms, cfg, cb)
        except Exception as e:  # um mercado fora do ar não derruba os outros
            results[store["id"]] = {"info": {"id": store["id"], "name": store["name"], "site": store["site"], "status": "falhou", "reason": str(e)[:120], "products": 0}, "products": []}
        if on_progress:
            on_progress(store["id"], len(terms), len(terms))
        r = results[store["id"]]["info"]
        print(f"  {store['name']}: {r['status']}, {r['products']} produtos {r['reason']}", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, len(selected))) as pool:  # mercados em paralelo, em segundo plano
        list(pool.map(work, selected))
    stores_out, products = [], []
    for store in selected:
        r = results[store["id"]]
        stores_out.append(r["info"])
        for p in r["products"]:
            p["category"] = category_of.get(p["term"], "Outros")
            if p.get("listPrice", 0) > p["price"]:
                p["promo"] = True
        products.extend(r["products"])
    return stores_out, products


def write_prices(out: Path, cfg: dict[str, Any], stores_out: list[dict[str, Any]], products: list[dict[str, Any]], keep_others: Optional[set[str]] = None) -> int:
    """Grava prices.json de forma atômica. Com `keep_others` (ids refeitos), mantém os mercados que não foram refeitos do arquivo atual."""
    out.parent.mkdir(parents=True, exist_ok=True)
    if keep_others and out.exists():
        old = json.loads(out.read_text(encoding="utf-8"))
        stores_out = [s for s in old.get("stores", []) if s["id"] not in keep_others] + stores_out
        products = [p for p in old.get("products", []) if p["store"] not in keep_others] + products
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "region": cfg["region"],
        "stores": stores_out,
        "products": products,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out)
    return len(products)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="../docs/data/prices.json")
    ap.add_argument("--limit-terms", type=int, default=0, help="só os N primeiros termos (teste rápido)")
    ap.add_argument("--stores", default="", help="ids separados por vírgula (padrão: todos)")
    ap.add_argument("--merge", action="store_true", help="com --stores: refaz só esses mercados e mantém os outros do arquivo atual")
    ap.add_argument("--encartes-only", action="store_true", help="só atualiza os encartes (rápido)")
    ap.add_argument("--pdf-only", action="store_true", help="só relê os encartes em PDF e troca as ofertas deles no arquivo atual (rápido)")
    args = ap.parse_args()
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    if args.encartes_only:
        write_encartes(cfg, Path(args.out).parent)
        return 0
    if args.pdf_only:
        out = Path(args.out)
        if not out.exists():
            print("erro: não há prices.json para atualizar (rode a coleta completa antes)", file=sys.stderr)
            return 1
        data = json.loads(out.read_text(encoding="utf-8"))
        stores = {p["store"] for p in cfg.get("pdfs", [])}
        keep = [p for p in data["products"] if not (p["store"] in stores and ":pdf:" in p["id"])]
        novos = collect_pdf_offers(cfg, load_all_terms())
        write_prices(out, cfg, data["stores"], keep + novos)
        print(f"ok: {len(novos)} ofertas de PDF -> {out}")
        return 0
    pairs = load_all_terms()
    if args.limit_terms:
        pairs = pairs[: args.limit_terms]
    wanted = {s for s in args.stores.split(",") if s}
    selected = [st for st in cfg["stores"] if not wanted or st["id"] in wanted]
    stores_out, products = run_scan(cfg, pairs, selected)
    if not wanted or {p['store'] for p in cfg.get('pdfs', [])} & wanted:
        products += collect_pdf_offers(cfg, pairs)
    if not products:
        print("erro: nenhum produto coletado", file=sys.stderr)
        return 1
    n = write_prices(Path(args.out), cfg, stores_out, products, wanted if args.merge else None)
    print(f"ok: {n} produtos -> {args.out}")
    write_encartes(cfg, Path(args.out).parent)
    return 0


if __name__ == "__main__":
    sys.exit(main())
