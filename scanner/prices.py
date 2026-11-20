"""Funções puras do coletor: leitura do tamanho da embalagem, preço por kg/litro e conversão da resposta VTEX. Sem rede, cobertas por testes."""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

# 5kg, 500 g, 1,5l, 900ml, 12un, 30 unidades
_SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(kg|g|gr|mg|l|lt|litros?|ml|un|und|unid|unidades?)\b", re.IGNORECASE)
_TO_BASE = {"kg": ("kg", 1.0), "g": ("kg", 0.001), "gr": ("kg", 0.001), "mg": ("kg", 0.000001),
            "l": ("l", 1.0), "lt": ("l", 1.0), "litro": ("l", 1.0), "litros": ("l", 1.0), "ml": ("l", 0.001),
            "un": ("un", 1.0), "und": ("un", 1.0), "unid": ("un", 1.0), "unidade": ("un", 1.0), "unidades": ("un", 1.0)}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def parse_size(name: str) -> Optional[dict[str, Any]]:
    """Tamanho da embalagem pelo nome: {'amount': 5.0, 'unit': 'kg'} (g e ml viram kg e l). None se não achar. Vale o último tamanho do nome."""
    last = None
    for m in _SIZE.finditer(name):
        last = m
    if last is None:
        return None
    base, factor = _TO_BASE[last.group(2).lower()]
    amount = float(last.group(1).replace(",", ".")) * factor
    if amount <= 0:
        return None
    return {"amount": round(amount, 6), "unit": base}


def unit_price(price: float, size: Optional[dict[str, Any]]) -> Optional[float]:
    """Preço por kg, litro ou unidade; None sem tamanho."""
    if size is None or size["amount"] <= 0:
        return None
    return round(price / size["amount"], 2)


def vtex_product(store_id: str, term: str, raw: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Um produto da busca VTEX -> registro do catálogo; None se indisponível, sem preço ou torto."""
    try:
        item = raw["items"][0]
        offer = item["sellers"][0]["commertialOffer"]
        price = float(offer["Price"])
        if price <= 0 or int(offer.get("AvailableQuantity", 0)) <= 0:
            return None
        name = str(raw["productName"]).strip()
        images = item.get("images") or []
        size = parse_size(name)
        return {
            "id": f"{store_id}:{raw['productId']}",
            "store": store_id,
            "name": name,
            "brand": str(raw.get("brand") or ""),
            "price": round(price, 2),
            "listPrice": round(float(offer.get("ListPrice") or price), 2),
            "size": size,
            "unitPrice": unit_price(price, size),
            "url": str(raw.get("link") or ""),
            "image": str(images[0].get("imageUrl")) if images and images[0].get("imageUrl") else None,
            "term": term,
        }
    except (KeyError, IndexError, TypeError, ValueError):
        return None
