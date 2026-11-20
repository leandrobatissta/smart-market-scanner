"""Confere no Data Market (API comercial) quais das redes que importam existem entre as lojas monitoradas de Santa Catarina.

A chave vem de DATAMARKET_API_KEY (variável de ambiente) ou da linha DATAMARKET_API_KEY=... do arquivo scanner/.env (que NÃO vai ao GitHub).
A chave nunca é impressa. Uso: python datamarket_check.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

BASE = "https://datamarket.cnovatech.com.br/api/v1"
REDES = ["imperatriz", "giassi", "bistek", "fort", "angeloni"]


def ler_chave(env: Optional[dict[str, str]] = None, arquivo: Optional[Path] = None) -> Optional[str]:
    """Chave da variável de ambiente ou do .env; None se não houver (ou se for só o começo cortado, 'dm_xxx...')."""
    env = os.environ if env is None else env
    arquivo = arquivo or Path(__file__).parent / ".env"
    chave = env.get("DATAMARKET_API_KEY", "").strip()
    if not chave and arquivo.exists():
        for linha in arquivo.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if linha.startswith("DATAMARKET_API_KEY="):
                chave = linha.split("=", 1)[1].strip().strip("'\"")
    if not chave or chave.endswith("...") or len(chave) < 16:
        return None
    return chave


def get(caminho: str, chave: str, params: Optional[dict[str, Any]] = None) -> Any:
    q = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(f"{BASE}{caminho}{q}", headers={"X-API-Key": chave, "User-Agent": "smart-market-scanner/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def lojas_da_rede(chave: str, rede: str, estado: str = "SC") -> list[dict[str, Any]]:
    dados = get("/market/stores", chave, {"search": rede, "state": estado, "limit": 50})
    itens = dados.get("data") or dados.get("items") or dados.get("stores") or (dados if isinstance(dados, list) else [])
    return [i for i in itens if isinstance(i, dict)]


def main() -> int:
    chave = ler_chave()
    if not chave:
        print("Sem chave completa. Crie o arquivo scanner/.env com a linha:\n  DATAMARKET_API_KEY=<a chave inteira>\n(a tela do painel mostra só o começo; use o botão de copiar.)")
        return 2
    try:
        for rede in REDES:
            lojas = lojas_da_rede(chave, rede)
            nomes = sorted({str(l.get("name") or l.get("nome") or l.get("store_name") or l.get("id")) for l in lojas})[:6]
            print(f"{rede:11} {len(lojas):3} loja(s) em SC  {nomes}")
    except urllib.error.HTTPError as e:
        print(f"A API respondeu {e.code}: {e.read()[:200].decode('utf-8', 'replace')}")
        return 1
    except urllib.error.URLError as e:
        print(f"Sem conexão com a API: {e.reason}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
