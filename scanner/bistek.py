"""Bistek: a busca (/api, /busca) é proibida pelo robots.txt, mas as páginas de categoria e a de ofertas são públicas e já trazem os produtos e preços em
dado estruturado (JSON-LD ItemList). Funções puras (sem rede), cobertas por testes."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from prices import parse_size, strip_accents, unit_price

_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
_LD = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)


def sitemap_urls(xml: str) -> list[str]:
    return _LOC.findall(xml)


def _slug_tokens(url: str) -> set[str]:
    path = re.sub(r"^https?://[^/]+", "", url)
    return {t for t in re.split(r"[^a-z0-9]+", strip_accents(path).lower()) if t}


def _words(term: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", strip_accents(term).lower()) if t and not re.match(r"^\d+([.,]\d+)?(kg|g|gr|l|lt|ml|un)$", t)]


def _stem(w: str) -> str:
    return w[:5]


def _matches(word: str, tokens: set[str]) -> bool:
    """A palavra casa com algum termo do caminho pelo radical (leite~leites, dental~dentais, tomate~tomates)."""
    s = _stem(word)
    return any(t.startswith(s) or (len(t) >= 4 and word.startswith(_stem(t))) for t in tokens)


def select_category_urls(urls: list[str], term: str, limit: int) -> list[str]:
    """Categorias cujo caminho tem a palavra principal do termo (a 1ª); ganham as que casam mais palavras e, no empate, as mais gerais (caminho curto).
    Casa pelo radical, então 'leite integral' acha 'leites-e-bebidas-lacteas' e 'creme dental' acha 'cremes-dentais'."""
    words = _words(term)
    if not words:
        return []
    scored = []
    for u in urls:
        toks = _slug_tokens(u)
        if not _matches(words[0], toks):
            continue
        hit = sum(1 for w in words if _matches(w, toks))
        scored.append((-hit, u.count("/"), len(u), u))
    scored.sort()
    return [u for *_, u in scored[:limit]]


def parse_itemlist(html: str, store_id: str, term: str, source: str = "", promo: bool = False) -> list[dict[str, Any]]:
    """Produtos do JSON-LD ItemList da página (categoria ou ofertas). Sem preço ou fora de estoque ficam de fora."""
    out: list[dict[str, Any]] = []
    for block in _LD.findall(html):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if not isinstance(data, dict) or data.get("@type") != "ItemList":
            continue
        for el in data.get("itemListElement", []):
            item = el.get("item") if isinstance(el, dict) else None
            if not isinstance(item, dict) or item.get("@type") != "Product":
                continue
            p = _product(item, store_id, term, source, promo)
            if p:
                out.append(p)
    return out


def _product(item: dict[str, Any], store_id: str, term: str, source: str, promo: bool) -> Optional[dict[str, Any]]:
    try:
        offers = item["offers"]
        offer = offers["offers"][0] if isinstance(offers.get("offers"), list) and offers["offers"] else offers
        price = float(offer.get("price") or offers.get("lowPrice"))
        if price <= 0 or "OutOfStock" in str(offer.get("availability", "")):
            return None
        name = str(item["name"]).strip()
        url = str(item.get("@id") or item.get("url") or "")
        sku = str(offer.get("sku") or re.sub(r"\D", "", url.rsplit("-", 1)[-1]) or url)
        image = item.get("image")
        image = image[0] if isinstance(image, list) and image else image
        brand = item.get("brand")
        size = parse_size(name)
        return {
            "id": f"{store_id}:{sku}",
            "store": store_id,
            "name": name,
            "brand": str(brand.get("name")) if isinstance(brand, dict) and brand.get("name") else "",
            "price": round(price, 2),
            "listPrice": round(price, 2),
            "size": size,
            "unitPrice": unit_price(price, size),
            "url": url,
            "image": str(image) if isinstance(image, str) and image else None,
            "term": term,
            **({"promo": True, "promoSource": source} if promo else {}),
        }
    except (KeyError, IndexError, TypeError, ValueError):
        return None
