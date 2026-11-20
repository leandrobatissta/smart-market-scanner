"""Coletor de preços: busca cada termo de terms.txt na loja virtual de cada mercado (API pública VTEX) e grava docs/data/prices.json.

Respeita o robots.txt de cada site (mercado que proíbe a busca é pulado, com o motivo no JSON), usa um pedido por vez e espera entre eles.
Uso: python scan.py --out ../docs/data/prices.json [--limit-terms 10]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from forte import parse_product_page, product_urls, select_urls
from prices import vtex_product

HERE = Path(__file__).parent
SEARCH_PATH = "/api/catalog_system/pub/products/search"


def load_terms(path: Path) -> list[str]:
    return [l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith("#")]


def allowed(site: str, path: str, ua: str, robots_text: Optional[str]) -> bool:
    """O robots.txt do site permite buscar `path`? Sem robots.txt legível, vale permitido (padrão da própria convenção)."""
    if robots_text is None:
        return True
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(robots_text.splitlines())
    return rp.can_fetch(ua, site + path)


def http_text(url: str, ua: str, timeout: int = 20) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.read().decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError, ValueError):
        return None


def search(site: str, term: str, limit: int, ua: str) -> list[dict[str, Any]]:
    q = urllib.parse.urlencode({"ft": term, "_from": 0, "_to": max(limit - 1, 0)}, quote_via=urllib.parse.quote)  # o espaço vira %20 (a VTEX recusa "+")
    body = http_text(f"{site}{SEARCH_PATH}?{q}", ua)
    if body is None:
        raise RuntimeError("sem resposta")
    data = json.loads(body)
    if not isinstance(data, list):
        raise RuntimeError("resposta inesperada")
    return data


def scan_forte(store: dict[str, Any], terms: list[str], cfg: dict[str, Any]) -> dict[str, Any]:
    """Sitemap -> páginas de produto escolhidas pelo nome -> preço em JSON-LD. Sem API, mas dentro do que o robots.txt permite (/produtos/)."""
    ua, site = cfg["userAgent"], store["site"]
    info = {"id": store["id"], "name": store["name"], "site": site, "status": "ok", "reason": "", "products": 0}
    robots = http_text(site + "/robots.txt", ua)
    sample = site + "/produtos/1/x"
    if not allowed(site, "/produtos/1/x", ua, robots):
        info.update(status="bloqueado", reason="o robots.txt do site não permite ler as páginas de produto")
        return {"info": info, "products": []}
    sitemap = http_text(site + "/sitemap.xml", ua, timeout=60)
    urls = product_urls(sitemap) if sitemap else []
    if not urls:
        info.update(status="falhou", reason="sitemap indisponível")
        return {"info": info, "products": []}
    seen: dict[str, dict[str, Any]] = {}
    fetched: set[str] = set()
    failures = 0
    for term in terms:
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
    info["products"] = len(seen)
    if failures:
        info["reason"] = f"{failures} página(s) sem resposta"
    return {"info": info, "products": list(seen.values())}


def scan_store(store: dict[str, Any], terms: list[str], cfg: dict[str, Any]) -> dict[str, Any]:
    if store.get("kind") == "forte":
        return scan_forte(store, terms, cfg)
    return scan_vtex(store, terms, cfg)


def scan_vtex(store: dict[str, Any], terms: list[str], cfg: dict[str, Any]) -> dict[str, Any]:
    ua, site = cfg["userAgent"], store["site"]
    info = {"id": store["id"], "name": store["name"], "site": site, "status": "ok", "reason": "", "products": 0}
    robots = http_text(site + "/robots.txt", ua)
    if not allowed(site, SEARCH_PATH, ua, robots):
        info.update(status="bloqueado", reason="o robots.txt do site não permite a busca automatizada")
        return {"info": info, "products": []}
    seen: dict[str, dict[str, Any]] = {}
    failures = 0
    for term in terms:
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
    info["products"] = len(seen)
    if failures:
        info["reason"] = f"{failures} termo(s) sem resposta"
    return {"info": info, "products": list(seen.values())}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="../docs/data/prices.json")
    ap.add_argument("--limit-terms", type=int, default=0, help="só os N primeiros termos (teste rápido)")
    ap.add_argument("--stores", default="", help="ids separados por vírgula (padrão: todos)")
    args = ap.parse_args()
    cfg = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
    terms = load_terms(HERE / "terms.txt")
    if args.limit_terms:
        terms = terms[: args.limit_terms]
    wanted = {s for s in args.stores.split(",") if s}
    stores_out, products = [], []
    for store in cfg["stores"]:
        if wanted and store["id"] not in wanted:
            continue
        print(f"{store['name']}: {len(terms)} termos…")
        r = scan_store(store, terms, cfg)
        stores_out.append(r["info"])
        products.extend(r["products"])
        print(f"  {r['info']['status']}: {r['info']['products']} produtos {r['info']['reason']}")
    if not products:
        print("erro: nenhum produto coletado", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "region": cfg["region"],
        "stores": stores_out,
        "products": products,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out)
    print(f"ok: {len(products)} produtos -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
