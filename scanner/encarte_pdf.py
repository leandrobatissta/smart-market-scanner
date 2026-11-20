"""Encarte semanal em PDF com texto (o do Angeloni): lê as ofertas e a validade e devolve produtos com data de validade.

O PDF é um arquivo público do próprio mercado. Cada oferta é "nome ... Quant. Disp. N un [DE: R$ x] [POR:] R$ preço"; os cartões com variações trazem
vários "nome + R$ preço" depois do mesmo cabeçalho. A leitura é conservadora: só entra o que tem preço claro depois do nome. Funções puras, com testes."""
from __future__ import annotations

import hashlib
import re
from datetime import date
from typing import Any, Optional

from prices import parse_size, strip_accents, unit_price

_VALID = re.compile(r"de\s+(\d{2})/(\d{2})/(\d{4})\s+a\s+(\d{2})/(\d{2})/(\d{4})", re.I)
_PRECO = re.compile(r"^R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$")
_INLINE = re.compile(r"R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})")
_PRECO_SOLTO = re.compile(r"^(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$")
_RUIDO = re.compile(r"^(ou\s+\d+x|valor com desconto|pre[cç]o\s*kg|receba|whatsapp|escaneie|ofertas v[aá]lidas|quantidade limitada|santa catarina|\(?exceto|e jurer|rede angeloni|\*|ref\.|leve\b.*pague\b|de:|por:)", re.I)
_LIXO = [re.compile(p, re.I) for p in (r"\b(DE|POR):?\s*R\$\s*[\d.,]+", r"R\$\s*[\d.,]+", r"\b\d{2}\s*\d{4}-\d{4}\b", r"\bde\s+\d{2}/\d{2}/\d{4}\s+a\s+\d{2}/\d{2}/\d{4}\.?", r"^\W*(e\s+)?jurer[eê]\)?,?")]


def _num(a: str, b: str) -> float:
    return float(f"{a.replace('.', '')}.{b}")


def validade(texto: str) -> Optional[tuple[str, str]]:
    """('AAAA-MM-DD', 'AAAA-MM-DD') da primeira frase 'de 19/11/2026 a 22/11/2026'; None se não achar ou se for inválida."""
    m = _VALID.search(texto)
    if not m:
        return None
    try:
        ini = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        fim = date(int(m.group(6)), int(m.group(5)), int(m.group(4)))
    except ValueError:
        return None
    return (ini.isoformat(), fim.isoformat()) if ini <= fim else None


def _limpa_nome(linhas: list[str]) -> str:
    nome = " ".join(l.strip() for l in linhas if l.strip())
    for rx in _LIXO:
        nome = rx.sub(" ", nome)
    nome = re.sub(r"\s*-\s*(cada|a cada\s*\d+\s*(g|kg|ml|l))\s*$", "", nome, flags=re.I)
    nome = re.sub(r"\s+", " ", nome).strip(" -–/")
    return nome[:110]


def _preco_depois(linhas: list[str], j: int) -> tuple[Optional[float], int]:
    """Preço na linha j ('R$' + número na linha seguinte, ou 'R$ 4,99' na mesma). Devolve (preço, próxima linha)."""
    l = linhas[j]
    if l == "R$" and j + 1 < len(linhas) and _PRECO_SOLTO.match(linhas[j + 1]):
        m = _PRECO_SOLTO.match(linhas[j + 1])
        return _num(m.group(1), m.group(2)), j + 2
    m = _PRECO.match(l)
    if m:
        return _num(m.group(1), m.group(2)), j + 1
    return None, j


def ler_ofertas(texto: str) -> list[dict[str, Any]]:
    """Ofertas [{name, price, listPrice}] do texto do PDF. Preço fora de 0,01-999,99 e nome sem letras ficam de fora."""
    linhas = [l.strip() for l in texto.splitlines() if l.strip()]
    ofertas: list[dict[str, Any]] = []
    cabecalho: list[str] = []
    card = ""
    i = 0
    while i < len(linhas):
        l = linhas[i]
        if _RUIDO.match(l) and not l.lower().startswith(("de:", "por:")):
            i += 1
            continue
        if l.lower().startswith("quant. disp"):
            card = _limpa_nome(cabecalho)
            cabecalho = []
            variantes: list[str] = []
            de: Optional[float] = None
            j, achou = i + 1, False
            while j < len(linhas) and j < i + 10 and not linhas[j].lower().startswith("quant. disp"):
                x = linhas[j]
                if x.lower().startswith("de:"):
                    m = _INLINE.search(x) or (_INLINE.search(linhas[j + 1]) if j + 1 < len(linhas) else None)
                    de = _num(m.group(1), m.group(2)) if m else de
                    j += 1
                    continue
                if x.lower().startswith("por:") or _RUIDO.match(x):
                    j += 1
                    continue
                preco, prox = _preco_depois(linhas, j)
                if preco is not None:
                    nome = card if not variantes else f"{card} {_limpa_nome(variantes)}"
                    ofertas.append({"name": nome, "price": preco, "listPrice": de})
                    j, achou = prox, True
                    break
                variantes.append(x)
                j += 1
            i = j if achou else i + 1
            continue
        preco, prox = _preco_depois(linhas, i)
        if preco is not None:
            # "nome + R$ preço" sem 'Quant. Disp.': variação do cartão anterior
            if cabecalho:
                ofertas.append({"name": _limpa_nome(cabecalho), "price": preco, "listPrice": None})
            cabecalho = []
            i = prox
            continue
        cabecalho.append(l)
        cabecalho = cabecalho[-4:]
        i += 1
    vistos, out = set(), []
    for o in ofertas:
        letras = len(re.findall(r"[A-Za-zÀ-ÿ]", o["name"]))
        if letras < 4 or not (0 < o["price"] < 1000):
            continue
        chave = (strip_accents(o["name"]).lower(), o["price"])
        if chave in vistos:
            continue
        vistos.add(chave)
        out.append(o)
    return out


def em_produtos(ofertas: list[dict[str, Any]], store_id: str, ate: str, url: str, categoria: Any) -> list[dict[str, Any]]:
    """Ofertas -> produtos do catálogo, marcados como encarte, com validade e categoria pelo nome."""
    out = []
    for o in ofertas:
        size = parse_size(o["name"])
        chave = hashlib.sha1(f"{strip_accents(o['name']).lower()}|{o['price']}".encode()).hexdigest()[:10]
        out.append({
            "id": f"{store_id}:pdf:{ate}:{chave}", "store": store_id, "name": o["name"], "brand": "", "price": round(o["price"], 2),
            "listPrice": round(o["listPrice"], 2) if o.get("listPrice") and o["listPrice"] > o["price"] else round(o["price"], 2),
            "size": size, "unitPrice": unit_price(o["price"], size), "url": url, "image": None, "term": "encarte",
            "category": categoria(o["name"]), "promo": True, "source": "encarte", "validUntil": ate,
        })
    return out


def categoria_pelo_nome(pares: list[tuple[str, str]]) -> Any:
    """Função nome -> categoria: a do primeiro termo cujas palavras principais (sem tamanho) estão todas no nome; senão 'Ofertas do encarte'."""
    termos = []
    for termo, cat in pares:
        palavras = [w for w in re.split(r"[^a-z0-9]+", strip_accents(termo).lower()) if w and not re.match(r"^\d+(kg|g|l|ml|un)$", w)]
        if palavras:
            termos.append((palavras, cat))

    def f(nome: str) -> str:
        toks = [t for t in re.split(r"[^a-z0-9]+", strip_accents(nome).lower()) if t]
        for palavras, cat in termos:
            if all(any(t.startswith(w[:5]) for t in toks) for w in palavras):
                return cat
        return "Ofertas do encarte"
    return f


def extrair_texto(pdf: bytes) -> str:
    """Texto de todas as páginas (pypdf)."""
    import io
    from pypdf import PdfReader
    leitor = PdfReader(io.BytesIO(pdf))
    return "\n".join((p.extract_text() or "") for p in leitor.pages)
