"""Encartes (folhetos) de cada rede, a partir da página da rede no Tiendeo (dado estruturado OfferCatalog: nome, datas e capa).

Só lemos a página da rede (permitida pelo robots.txt); as páginas dos folhetos (/Catalogos/) são proibidas ao robô e ficam apenas como link para a pessoa abrir.
O encarte não vira preço aqui (isso exigiria OCR): o site mostra capa, validade e o link para abrir o folheto. Funções puras, cobertas por testes."""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, Optional

_LD = re.compile(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)
_ID = re.compile(r"small_(\d+)@")
_CAT_LINK = re.compile(r'href="(/Catalogos/(\d+))[^"]*"')


def _day(s: Any) -> Optional[str]:
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(s or ""))
    return m.group(1) if m else None


def parse_catalog_page(html: str, store_id: str, source_url: str) -> list[dict[str, Any]]:
    """Encartes da página da rede: [{id, store, title, start, end, image, url, source}]. Sem datas válidas, fica de fora."""
    known_links = {m.group(2): "https://www.tiendeo.com.br" + m.group(1) for m in _CAT_LINK.finditer(html)}
    out: list[dict[str, Any]] = []
    for block in _LD.findall(html):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        for d in data if isinstance(data, list) else [data]:
            if not isinstance(d, dict) or d.get("@type") != "OfferCatalog":
                continue
            for ev in d.get("itemListElement", []):
                if not isinstance(ev, dict):
                    continue
                start, end = _day(ev.get("startDate")), _day(ev.get("endDate"))
                title = str(ev.get("name") or "").strip()
                image = ev.get("image")
                if not (start and end and title):
                    continue
                m = _ID.search(str(image or ""))
                cid = m.group(1) if m else ""
                out.append({
                    "id": f"{store_id}:{cid or title.lower()}-{start}",
                    "store": store_id,
                    "title": title[:100],
                    "start": start,
                    "end": end,
                    "image": str(image) if isinstance(image, str) and image.startswith("https://") else None,
                    "url": known_links.get(cid) or source_url,
                    "source": "Tiendeo",
                })
    return out


def current(encartes: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    """Só os vigentes (já começaram e não terminaram), sem repetidos e do que acaba antes para o que acaba depois."""
    seen, out = set(), []
    for e in encartes:
        if e["id"] in seen:
            continue
        try:
            start, end = date.fromisoformat(e["start"]), date.fromisoformat(e["end"])
        except ValueError:
            continue
        if end < today:
            continue
        seen.add(e["id"])
        out.append({**e, "active": start <= today})
    out.sort(key=lambda e: (e["store"], e["end"]))
    return out
