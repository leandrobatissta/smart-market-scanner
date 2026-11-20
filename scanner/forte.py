"""Forte Atacadista: sem API pública, mas o sitemap lista as páginas de produto (que o robots.txt permite) e cada página traz o preço em JSON-LD.
Funções puras (sem rede), cobertas por testes."""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from prices import parse_size, strip_accents, unit_price

_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>")
_LD = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)
_SIZE_TOKEN = re.compile(r"^\d+([.,]\d+)?(kg|g|gr|l|lt|ml|un|und)$")
_PRODUCT_PATH = re.compile(r"^https://[^/]+/produtos/(\d+)/([a-z0-9-]+)$")


def product_urls(sitemap_xml: str) -> list[str]:
    """URLs de produto (sem query) do sitemap."""
    return [u for u in _LOC.findall(sitemap_xml) if _PRODUCT_PATH.match(u)]


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", strip_accents(s).lower()) if t]


def select_urls(urls: list[str], term: str, limit: int) -> list[str]:
    """Páginas cujo nome (slug) tem todas as palavras do termo (menos o tamanho); as que também têm o tamanho vêm primeiro."""
    words = [t for t in _tokens(term) if not _SIZE_TOKEN.match(t)]
    sizes = [t for t in _tokens(term) if _SIZE_TOKEN.match(t)]
    if not words:
        return []
    hits: list[tuple[int, str]] = []
    for u in urls:
        m = _PRODUCT_PATH.match(u)
        slug = set(_tokens(m.group(2))) if m else set()
        # o tamanho aparece no slug como "5-kg" ou "5kg": junta os tokens vizinhos para conferir
        joined = "".join(_tokens(m.group(2))) if m else ""
        if all(w in slug for w in words):
            hits.append((0 if all(s in joined for s in sizes) else 1, u))
    hits.sort(key=lambda x: (x[0], len(x[1])))
    return [u for _, u in hits[:limit]]


def parse_product_page(html: str, url: str, store_id: str, term: str) -> Optional[dict[str, Any]]:
    """Produto da página (JSON-LD Product/Offer); None se não achar ou sem preço."""
    for block in _LD.findall(html):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for item in data if isinstance(data, list) else [data]:
            if not isinstance(item, dict) or item.get("@type") != "Product":
                continue
            offers = item.get("offers")
            offer = offers[0] if isinstance(offers, list) and offers else offers
            try:
                price = float(str(offer["price"]).replace(",", "."))
            except (KeyError, TypeError, ValueError):
                return None
            if price <= 0 or "OutOfStock" in str(offer.get("availability", "")):
                return None
            name = str(item.get("name") or "").strip()
            if not name:
                return None
            image = item.get("image")
            image = image[0] if isinstance(image, list) and image else image
            brand = item.get("brand")
            size = parse_size(name)
            m = _PRODUCT_PATH.match(url)
            return {
                "id": f"{store_id}:{m.group(1) if m else item.get('sku', url)}",
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
            }
    return None
