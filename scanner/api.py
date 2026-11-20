"""API local (Docker): o site pede aqui a busca de um item novo em TODOS os mercados cadastrados, em segundo plano.

GET /api/health            -> {"ok": true}
GET /api/search?q=<item>   -> {"id": "...", "status": "running"}   (a busca roda em threads, um por mercado; a resposta é imediata)
GET /api/job?id=<id>       -> {"status": "running|done", "stores": {id: {"name", "status", "count"}}, "products": [...]}   (parcial enquanto roda)
POST /api/refresh          -> inicia a ATUALIZAÇÃO DA BASE (coleta completa de todos os mercados e dos encartes) em segundo plano
GET /api/refresh/status    -> {"status": "idle|running|done|error", "percent": 0-100, "stores": {id: {"name", "done", "total"}}, ...}
O item entra em user_terms.txt para as coletas agendadas. Só aceita termos curtos (letras, números e espaço) e poucas buscas ao mesmo tempo,
para não sobrecarregar os mercados.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import scan
from prices import strip_accents

TERM = re.compile(r"^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 ]{1,39}$")
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
REFRESH: dict[str, Any] = {"status": "idle", "percent": 0, "stores": {}}
REFRESH_LOCK = threading.Lock()
MAX_JOBS = 2
JOB_TTL = 15 * 60
JOBS: dict[str, dict[str, Any]] = {}
JOBS_LOCK = threading.Lock()


def clean_term(raw: str) -> Optional[str]:
    """Termo válido (2 a 40 caracteres, só letras, números e espaço) sem acento e em minúsculas; None se inválido."""
    t = " ".join((raw or "").split())
    if not TERM.match(t):
        return None
    return strip_accents(t).lower()


def remember(term: str, path: Path = scan.USER_TERMS) -> bool:
    """Acrescenta o termo a user_terms.txt (se ainda não estiver em nenhuma lista). True se acrescentou."""
    known = {t for t, _ in scan.load_all_terms()}
    if term in known:
        return False
    with path.open("a", encoding="utf-8") as f:
        f.write(term + "\n")
    return True


def _search_store(job: dict[str, Any], store: dict[str, Any], cfg: dict[str, Any]) -> None:
    sid = job["stores"][store["id"]]
    sid["status"] = "buscando"
    try:
        r = scan.scan_store(store, [job["term"]], cfg)
    except Exception as e:  # um mercado fora do ar não derruba os outros
        sid.update(status="falhou", reason=str(e)[:100])
        return
    found = []
    for p in r["products"]:
        p["category"] = "Pedidos"
        if p.get("listPrice", 0) > p["price"]:
            p["promo"] = True
        found.append(p)
    with JOBS_LOCK:
        job["products"].extend(found)
    sid.update(status=r["info"]["status"] if r["info"]["status"] != "ok" else "ok", count=len(found), reason=r["info"].get("reason", ""))


def _run(job: dict[str, Any]) -> None:
    cfg = json.loads((scan.HERE / "config.json").read_text(encoding="utf-8"))
    with ThreadPoolExecutor(max_workers=len(cfg["stores"])) as pool:  # um thread por mercado, em paralelo
        for st in cfg["stores"]:
            pool.submit(_search_store, job, st, cfg)
    if job["products"]:
        try:
            job["added"] = remember(job["term"])
        except OSError as e:
            print("aviso: não consegui gravar user_terms.txt:", e)
    job["status"] = "done"
    job["finishedAt"] = time.time()


def start_job(term: str) -> Optional[dict[str, Any]]:
    """Cria a busca em segundo plano; None se já há buscas demais em andamento."""
    cfg = json.loads((scan.HERE / "config.json").read_text(encoding="utf-8"))
    with JOBS_LOCK:
        now = time.time()
        for k in [k for k, j in JOBS.items() if j["status"] == "done" and now - j.get("finishedAt", now) > JOB_TTL]:
            del JOBS[k]
        if sum(1 for j in JOBS.values() if j["status"] == "running") >= MAX_JOBS:
            return None
        job = {"id": uuid.uuid4().hex[:12], "term": term, "status": "running", "added": False, "products": [],
               "stores": {s["id"]: {"name": s["name"], "status": "na fila", "count": 0, "reason": ""} for s in cfg["stores"]}}
        JOBS[job["id"]] = job
    threading.Thread(target=_run, args=(job,), daemon=True).start()
    return job


def view(job: dict[str, Any]) -> dict[str, Any]:
    with JOBS_LOCK:
        return {"id": job["id"], "term": job["term"], "status": job["status"], "added": job["added"], "stores": {k: dict(v) for k, v in job["stores"].items()}, "products": list(job["products"])}


def refresh_view() -> dict[str, Any]:
    with REFRESH_LOCK:
        return {**REFRESH, "stores": {k: dict(v) for k, v in REFRESH["stores"].items()}}


def _refresh_percent(stores: dict[str, dict[str, Any]]) -> int:
    done = sum(s["done"] for s in stores.values())
    total = sum(s["total"] for s in stores.values()) or 1
    return min(95, int(done * 95 / total))   # os últimos 5% são gravar os arquivos e atualizar os encartes


def _run_refresh() -> None:
    try:
        cfg = json.loads((scan.HERE / "config.json").read_text(encoding="utf-8"))
        pairs = scan.load_all_terms()
        selected = cfg["stores"]

        def on_progress(sid: str, done: int, total: int) -> None:
            with REFRESH_LOCK:
                if sid in REFRESH["stores"]:   # mercado sem coleta (kind "none") não entra na conta
                    REFRESH["stores"][sid].update(done=done, total=max(total, 1))
                REFRESH["percent"] = max(REFRESH["percent"], _refresh_percent(REFRESH["stores"]))

        stores_out, products = scan.run_scan(cfg, pairs, selected, on_progress)
        if not products:
            raise RuntimeError("nenhum produto coletado (sem internet ou mercados fora do ar)")
        with REFRESH_LOCK:
            REFRESH["message"] = "gravando os preços…"
            REFRESH["percent"] = 96
        n = scan.write_prices(DATA_DIR / "prices.json", cfg, stores_out, products)
        with REFRESH_LOCK:
            REFRESH["message"] = "atualizando os encartes…"
            REFRESH["percent"] = 98
        scan.write_encartes(cfg, DATA_DIR)
        with REFRESH_LOCK:
            REFRESH.update(status="done", percent=100, message=f"{n} produtos", finishedAt=time.time(), products=n)
    except Exception as e:
        with REFRESH_LOCK:
            REFRESH.update(status="error", message=str(e)[:200], finishedAt=time.time())


def start_refresh() -> bool:
    """Inicia a atualização da base em segundo plano; False se já há uma rodando."""
    cfg = json.loads((scan.HERE / "config.json").read_text(encoding="utf-8"))
    total = max(len(scan.load_all_terms()), 1)   # total conhecido desde o começo: a porcentagem não pula
    with REFRESH_LOCK:
        if REFRESH["status"] == "running":
            return False
        REFRESH.clear()
        REFRESH.update(status="running", percent=0, message="coletando os mercados…", startedAt=time.time(),
                       stores={s["id"]: {"name": s["name"], "done": 0, "total": total} for s in cfg["stores"] if s.get("kind") != "none"})
    threading.Thread(target=_run_refresh, daemon=True).start()
    return True


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, body: dict[str, Any]) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/health":
            return self._json(200, {"ok": True})
        if u.path == "/api/search":
            term = clean_term((q.get("q") or [""])[0])
            if not term:
                return self._json(400, {"error": "item inválido (use 2 a 40 letras ou números)"})
            job = start_job(term)
            if job is None:
                return self._json(429, {"error": "já existem buscas em andamento, tente em instantes"})
            return self._json(202, view(job))
        if u.path == "/api/refresh/status":
            return self._json(200, refresh_view())
        if u.path == "/api/job":
            job = JOBS.get((q.get("id") or [""])[0])
            return self._json(200, view(job)) if job else self._json(404, {"error": "busca não encontrada"})
        return self._json(404, {"error": "não encontrado"})

    def do_POST(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        if u.path == "/api/refresh":
            if not start_refresh():
                return self._json(409, {**refresh_view(), "error": "já existe uma atualização em andamento"})
            return self._json(202, refresh_view())
        return self._json(404, {"error": "não encontrado"})

    def log_message(self, fmt: str, *args: Any) -> None:
        print("api:", fmt % args)


if __name__ == "__main__":
    print("api na porta 8081", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8081), Handler).serve_forever()
