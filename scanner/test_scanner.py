import unittest

from prices import parse_size, unit_price, vtex_product
from scan import allowed, decode_body, load_terms, load_terms_with_category, search_path
from robots import can_fetch
from pathlib import Path

UA = "smart-market-scanner/1.0"


def raw(price=19.99, qty=100, name="Arroz Branco Tipo 1 Kiarroz Pacote 5kg"):
    return {"productId": "12336", "productName": name, "brand": "Kiarroz", "link": "https://x/p",
            "items": [{"images": [{"imageUrl": "https://img/a.jpg"}], "sellers": [{"commertialOffer": {"Price": price, "ListPrice": 21.5, "AvailableQuantity": qty}}]}]}


class SizeTest(unittest.TestCase):
    def test_tamanhos(self):
        self.assertEqual(parse_size("Arroz 5kg"), {"amount": 5.0, "unit": "kg"})
        self.assertEqual(parse_size("Leite Integral 1,5L"), {"amount": 1.5, "unit": "l"})
        self.assertEqual(parse_size("Biscoito 130g"), {"amount": 0.13, "unit": "kg"})
        self.assertEqual(parse_size("Refrigerante 350 ml"), {"amount": 0.35, "unit": "l"})
        self.assertEqual(parse_size("Ovos 12 un"), {"amount": 12.0, "unit": "un"})

    def test_vale_o_ultimo_tamanho_e_sem_tamanho(self):
        self.assertEqual(parse_size("Pacote 2 x 500g c/ 1kg"), {"amount": 1.0, "unit": "kg"})
        self.assertIsNone(parse_size("Sabonete Dove"))
        self.assertIsNone(parse_size("Item 0kg"))

    def test_preco_por_unidade(self):
        self.assertEqual(unit_price(19.99, {"amount": 5.0, "unit": "kg"}), 4.0)
        self.assertIsNone(unit_price(10, None))


class VtexTest(unittest.TestCase):
    def test_produto_valido(self):
        p = vtex_product("giassi", "arroz 5kg", raw())
        self.assertEqual(p["id"], "giassi:12336")
        self.assertEqual(p["price"], 19.99)
        self.assertEqual(p["listPrice"], 21.5)
        self.assertEqual(p["unitPrice"], 4.0)
        self.assertEqual(p["image"], "https://img/a.jpg")

    def test_indisponivel_sem_preco_e_torto(self):
        self.assertIsNone(vtex_product("g", "t", raw(qty=0)))
        self.assertIsNone(vtex_product("g", "t", raw(price=0)))
        self.assertIsNone(vtex_product("g", "t", {"productId": "1"}))
        self.assertIsNone(vtex_product("g", "t", {"productId": "1", "productName": "x", "items": []}))


class RobotsTest(unittest.TestCase):
    SITE = "https://loja.exemplo.com.br"

    def test_robots_bloqueia_api(self):
        robots = "User-agent: *\nDisallow: /api/\nDisallow: /busca/\n"
        self.assertFalse(allowed(self.SITE, "/api/catalog_system/pub/products/search", UA, robots))

    def test_robots_libera(self):
        self.assertTrue(allowed(self.SITE, "/api/catalog_system/pub/products/search", UA, "User-agent: *\nDisallow: /busca\n"))
        self.assertTrue(allowed(self.SITE, "/api/x", UA, None))

    def test_termos_ignora_comentario_e_linha_vazia(self):
        p = Path(__file__).parent / "terms.txt"
        terms = load_terms(p)
        self.assertIn("arroz 5kg", terms)
        self.assertTrue(all(not t.startswith("#") and t for t in terms))



class ForteTest(unittest.TestCase):
    SITEMAP = """<urlset><url><loc>https://fortatacadista.com.br/categorias</loc></url>
    <url><loc>https://fortatacadista.com.br/produtos/1/arroz-tipo-1-camil-5-kg</loc></url>
    <url><loc>https://fortatacadista.com.br/produtos/2/arroz-integral-tio-joao-1-kg</loc></url>
    <url><loc>https://fortatacadista.com.br/produtos/3/feijao-preto-camil-1-kg</loc></url>
    <url><loc>https://fortatacadista.com.br/produtos/4/arroz-parboilizado-5kg</loc></url></urlset>"""

    def test_urls_de_produto_so(self):
        from forte import product_urls
        urls = product_urls(self.SITEMAP)
        self.assertEqual(len(urls), 4)
        self.assertTrue(all("/produtos/" in u for u in urls))

    def test_escolha_por_nome_e_tamanho(self):
        from forte import product_urls, select_urls
        urls = product_urls(self.SITEMAP)
        got = select_urls(urls, "arroz 5kg", 5)
        self.assertEqual(len(got), 3)
        self.assertTrue(got[0].endswith("arroz-tipo-1-camil-5-kg") or got[0].endswith("arroz-parboilizado-5kg"))
        self.assertEqual(select_urls(urls, "feijao preto", 5), ["https://fortatacadista.com.br/produtos/3/feijao-preto-camil-1-kg"])
        self.assertEqual(select_urls(urls, "5kg", 5), [])

    def test_pagina_de_produto(self):
        from forte import parse_product_page
        html = '<script type="application/ld+json">{"@type":"Product","name":"Arroz Tipo 1 Camil 5 kg","brand":{"@type":"Brand","name":"Camil"},"image":["https://i/a.jpg"],"offers":{"@type":"Offer","price":"22.90","availability":"https://schema.org/InStock"}}</script>'
        p = parse_product_page(html, "https://fortatacadista.com.br/produtos/1/arroz-tipo-1-camil-5-kg", "forte", "arroz 5kg")
        self.assertEqual((p["id"], p["price"], p["brand"], p["unitPrice"]), ("forte:1", 22.9, "Camil", 4.58))
        sem = html.replace("InStock", "OutOfStock")
        self.assertIsNone(parse_product_page(sem, "https://fortatacadista.com.br/produtos/1/x", "forte", "t"))
        self.assertIsNone(parse_product_page("<html></html>", "https://fortatacadista.com.br/produtos/1/x", "forte", "t"))



class RobotsWildcardTest(unittest.TestCase):
    ANGELONI = "User-agent: *\nDisallow: /busca\nDisallow: /*ft=*\nDisallow: /checkout\nDisallow: /buscapagina/*\n"

    def test_curinga_bloqueia_ft_mas_nao_a_busca_por_caminho(self):
        self.assertFalse(can_fetch(self.ANGELONI, UA, "/api/catalog_system/pub/products/search?ft=arroz&_from=0"))
        self.assertTrue(can_fetch(self.ANGELONI, UA, "/api/catalog_system/pub/products/search/arroz?_from=0&_to=11"))
        self.assertFalse(can_fetch(self.ANGELONI, UA, "/busca?q=arroz"))

    def test_caminho_mais_especifico_vence_e_dolar_ancora(self):
        robots = "User-agent: *\nDisallow: /produtos\nAllow: /produtos/publico\nDisallow: /*.pdf$\n"
        self.assertFalse(can_fetch(robots, UA, "/produtos/x"))
        self.assertTrue(can_fetch(robots, UA, "/produtos/publico/1"))
        self.assertFalse(can_fetch(robots, UA, "/a/b.pdf"))
        self.assertTrue(can_fetch(robots, UA, "/a/b.pdf?x=1"))

    def test_grupo_especifico_do_agente_e_sem_robots(self):
        robots = "User-agent: smart-market-scanner\nDisallow: /\n\nUser-agent: *\nAllow: /\n"
        self.assertFalse(can_fetch(robots, UA, "/qualquer"))
        self.assertTrue(can_fetch(None, UA, "/qualquer"))

    def test_busca_por_caminho(self):
        self.assertEqual(search_path("arroz 5kg", 12), "/api/catalog_system/pub/products/search/arroz%205kg?_from=0&_to=11")


class CategoriasTest(unittest.TestCase):
    def test_termos_com_categoria(self):
        pairs = load_terms_with_category(Path(__file__).parent / "terms.txt")
        d = dict(pairs)
        self.assertEqual(d["arroz 5kg"], "Mercearia")
        self.assertEqual(d["leite integral 1l"], "Laticínios e frios")
        self.assertEqual(d["sabonete"], "Higiene e beleza")
        self.assertTrue(all(c for _, c in pairs))
        self.assertEqual(len(pairs), len(load_terms(Path(__file__).parent / "terms.txt")))


class BistekTest(unittest.TestCase):
    URLS = ["https://www.bistek.com.br/mercearia/alimentos-basicos/arroz",
            "https://www.bistek.com.br/bem-estar-e-equilibrio/organicos/arroz-organico",
            "https://www.bistek.com.br/mercearia/cafes",
            "https://www.bistek.com.br/bebidas/refrigerantes"]

    def test_radical_acha_plural_e_variacao(self):
        from bistek import select_category_urls
        urls = ["https://www.bistek.com.br/bebidas/leites-e-bebidas-lacteas", "https://www.bistek.com.br/mercearia/cremes-de-leite-e-leites-condensados/doce-de-leite",
                "https://www.bistek.com.br/higiene/higiene-bucal/cremes-dentais", "https://www.bistek.com.br/hortifruti/tomates", "https://www.bistek.com.br/limpeza/lava-roupas/sabao-em-po"]
        self.assertEqual(select_category_urls(urls, "leite integral 1l", 1), ["https://www.bistek.com.br/bebidas/leites-e-bebidas-lacteas"])
        self.assertEqual(select_category_urls(urls, "creme dental", 1), ["https://www.bistek.com.br/higiene/higiene-bucal/cremes-dentais"])
        self.assertEqual(select_category_urls(urls, "tomate", 2), ["https://www.bistek.com.br/hortifruti/tomates"])
        self.assertEqual(select_category_urls(urls, "sabao em po", 1), ["https://www.bistek.com.br/limpeza/lava-roupas/sabao-em-po"])

    def test_categorias_por_palavra_do_termo(self):
        from bistek import select_category_urls
        self.assertEqual(select_category_urls(self.URLS, "arroz 5kg", 2)[0], "https://www.bistek.com.br/mercearia/alimentos-basicos/arroz")
        self.assertEqual(select_category_urls(self.URLS, "cafe 500g", 3), ["https://www.bistek.com.br/mercearia/cafes"])
        self.assertEqual(select_category_urls(self.URLS, "5kg", 3), [])

    def test_itemlist(self):
        from bistek import parse_itemlist
        item = {"@type": "Product", "@id": "https://www.bistek.com.br/requeijao-vigor-200g-light-1234030/p", "name": "Requeijão Light Vigor 200g",
                "brand": {"@type": "Brand", "name": "Vigor"}, "image": "https://img/a.png",
                "offers": {"@type": "AggregateOffer", "lowPrice": 7.18, "offers": [{"@type": "Offer", "price": 7.18, "sku": "1234030", "availability": "http://schema.org/InStock"}]}}
        out = {**item, "name": "Esgotado", "offers": {"offers": [{"price": 5, "availability": "http://schema.org/OutOfStock"}]}}
        import json
        html = '<script type="application/ld+json">' + json.dumps({"@type": "ItemList", "itemListElement": [{"item": item}, {"item": out}, {"item": {"@type": "Thing"}}]}) + "</script>"
        got = parse_itemlist(html, "bistek", "requeijao", "ofertas", True)
        self.assertEqual(len(got), 1)
        self.assertEqual((got[0]["id"], got[0]["price"], got[0]["brand"], got[0]["promo"]), ("bistek:1234030", 7.18, "Vigor", True))
        self.assertEqual(parse_itemlist("<html></html>", "bistek", "x"), [])


class DecodeTest(unittest.TestCase):
    def test_gzip_e_texto_puro(self):
        import gzip
        self.assertEqual(decode_body(gzip.compress("preço".encode("utf-8"))), "preço")
        self.assertEqual(decode_body("preço".encode("utf-8")), "preço")


class ApiTest(unittest.TestCase):
    def test_termo_valido_e_invalido(self):
        from api import clean_term
        self.assertEqual(clean_term("  Água   Mineral 1,5L".replace(",", " ")), "agua mineral 1 5l")
        self.assertEqual(clean_term("Pão de Queijo"), "pao de queijo")
        for bad in ("", "a", "x" * 41, "<script>", "arroz; rm -rf", "../etc", "a\nb;c"):
            self.assertIsNone(clean_term(bad), bad)

    def test_remember_nao_duplica(self):
        import tempfile
        from pathlib import Path
        import api, scan
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "user_terms.txt"
            old = scan.USER_TERMS
            scan.USER_TERMS = p
            try:
                self.assertTrue(api.remember("pao de queijo", p))
                self.assertFalse(api.remember("pao de queijo", p))
                self.assertFalse(api.remember("arroz 5kg", p))   # já está em terms.txt
                self.assertEqual(p.read_text(encoding="utf-8").strip().splitlines(), ["pao de queijo"])
                self.assertIn(("pao de queijo", "Pedidos"), scan.load_all_terms())
            finally:
                scan.USER_TERMS = old


class JobsTest(unittest.TestCase):
    def test_busca_em_segundo_plano_um_thread_por_mercado(self):
        import threading, time as _t
        import api, scan
        threads = set()
        orig = scan.scan_store

        def fake(store, terms, cfg):
            threads.add(threading.current_thread().name)
            _t.sleep(0.05)
            return {"info": {"id": store["id"], "status": "ok", "reason": ""}, "products": [{"id": f"{store['id']}:1", "store": store["id"], "name": "Pão", "price": 5.0, "listPrice": 6.0, "term": terms[0]}]}

        scan.scan_store = fake
        old_user, scan.USER_TERMS = scan.USER_TERMS, Path("/dev/null")
        try:
            job = api.start_job("pao de queijo")
            self.assertEqual(api.view(job)["status"], "running")      # a chamada volta na hora
            for _ in range(100):
                if api.view(job)["status"] == "done":
                    break
                _t.sleep(0.05)
            v = api.view(job)
            self.assertEqual(v["status"], "done")
            n = len(v["stores"])
            self.assertEqual(len(v["products"]), n)
            self.assertTrue(all(p["promo"] and p["category"] == "Pedidos" for p in v["products"]))
            self.assertGreater(len(threads), 1)                       # mercados em paralelo
        finally:
            scan.scan_store, scan.USER_TERMS = orig, old_user

    def test_limite_de_buscas_simultaneas(self):
        import time as _t
        import api
        api.JOBS.clear()
        api.JOBS.update({f"j{i}": {"id": f"j{i}", "status": "running", "finishedAt": _t.time()} for i in range(api.MAX_JOBS)})
        self.assertIsNone(api.start_job("arroz"))
        api.JOBS.clear()


class EncartesTest(unittest.TestCase):
    HTML = ('<a href="/Catalogos/1419163?utm_medium=rp">x</a><script type="application/ld+json">' + __import__("json").dumps({"@type": "OfferCatalog", "itemListElement": [
        {"@type": "SaleEvent", "name": "MODO BLACK", "startDate": "2026-11-18T00:00:00.000Z", "endDate": "2026-11-29T00:00:00.000Z", "image": "https://m/images/volantini/small_1419163@2x_webp.webp?m=1"},
        {"@type": "SaleEvent", "name": "Velho", "startDate": "2026-10-01T00:00:00.000Z", "endDate": "2026-10-10T00:00:00.000Z", "image": "https://m/images/volantini/small_1@2x_webp.webp"},
        {"@type": "SaleEvent", "name": "Futuro", "startDate": "2026-12-01T00:00:00.000Z", "endDate": "2026-12-20T00:00:00.000Z"},
        {"@type": "SaleEvent", "name": "", "startDate": "2026-11-18", "endDate": "2026-11-29"},
        {"@type": "SaleEvent", "name": "Sem data"}]}) + "</script>")

    def test_parse_e_vigentes(self):
        from datetime import date
        from encartes import current, parse_catalog_page
        all_ = parse_catalog_page(self.HTML, "imperatriz", "https://t/x")
        self.assertEqual([e["title"] for e in all_], ["MODO BLACK", "Velho", "Futuro"])   # sem nome ou sem data ficam de fora
        cur = current(all_, date(2026, 11, 20))
        self.assertEqual([e["title"] for e in cur], ["MODO BLACK", "Futuro"])             # o vencido sai
        self.assertTrue(cur[0]["active"] and not cur[1]["active"])
        self.assertEqual(cur[0]["url"], "https://www.tiendeo.com.br/Catalogos/1419163")    # link do folheto (só para abrir)
        self.assertEqual(cur[1]["url"], "https://t/x")

    def test_repetidos_e_html_vazio(self):
        from datetime import date
        from encartes import current, parse_catalog_page
        a = parse_catalog_page(self.HTML, "g", "u")
        self.assertEqual(len(current(a + a, date(2026, 11, 20))), 2)
        self.assertEqual(parse_catalog_page("<html></html>", "g", "u"), [])


class RefreshTest(unittest.TestCase):
    def test_atualizar_a_base_em_segundo_plano_com_porcentagem(self):
        import tempfile, time as _t
        import api, scan
        seen = []
        orig = scan.run_scan, scan.write_encartes, scan.collect_pdf_offers
        with tempfile.TemporaryDirectory() as d:
            def fake_scan(cfg, pairs, selected, on_progress=None):
                for step in range(0, 11, 5):
                    for st in selected:
                        on_progress(st["id"], step, 10)
                        seen.append(api.refresh_view()["percent"])
                    _t.sleep(0.02)
                return ([{"id": s["id"], "name": s["name"], "site": s["site"], "status": "ok", "reason": "", "products": 1} for s in selected],
                        [{"id": "x:1", "store": selected[0]["id"], "name": "Arroz", "price": 5.0, "listPrice": 5.0, "term": "arroz 5kg", "category": "Mercearia"}])
            scan.run_scan = fake_scan
            scan.collect_pdf_offers = lambda cfg, pairs: []
            scan.write_encartes = lambda cfg, folder: (folder / "encartes.json").write_text("{}")
            old_dir, api.DATA_DIR = api.DATA_DIR, Path(d)
            try:
                self.assertTrue(api.start_refresh())
                self.assertFalse(api.start_refresh())                       # só uma por vez
                for _ in range(200):
                    if api.refresh_view()["status"] != "running":
                        break
                    _t.sleep(0.02)
                v = api.refresh_view()
                self.assertEqual((v["status"], v["percent"]), ("done", 100))
                self.assertNotIn("imperatriz", v["stores"])                # sem coleta: fora da porcentagem
                self.assertLess(seen[0], 40)                                # começa baixo, não em 95%
                self.assertEqual(seen, sorted(seen))                        # a porcentagem nunca anda para trás
                self.assertLessEqual(max(seen), 95)                          # 95% é o teto da coleta; o resto é gravar
                self.assertTrue((Path(d) / "prices.json").exists() and (Path(d) / "encartes.json").exists())
            finally:
                scan.run_scan, scan.write_encartes, scan.collect_pdf_offers = orig
                api.DATA_DIR = old_dir

    def test_erro_vira_status_error(self):
        import api, scan
        orig, orig_pdf = scan.run_scan, scan.collect_pdf_offers
        scan.run_scan = lambda *a, **k: ([], [])
        scan.collect_pdf_offers = lambda cfg, pairs: [{'id': 'x'}]   # oferta de PDF sozinha não mascara coleta vazia
        try:
            api.start_refresh()
            import time as _t
            for _ in range(100):
                if api.refresh_view()["status"] != "running":
                    break
                _t.sleep(0.02)
            self.assertEqual(api.refresh_view()["status"], "error")
            self.assertIn("nenhum produto", api.refresh_view()["message"])
        finally:
            scan.run_scan, scan.collect_pdf_offers = orig, orig_pdf


class EncartePdfTest(unittest.TestCase):
    TEXTO = """Ofertas válidas para a rede Angeloni em
Santa Catarina (exceto Florianópolis Bocaiúva
e Jurerê), de 19/11/2026 a 22/11/2026.
Cerveja SPATEN
Puro Malte Lata
473ml - cada
Quant. Disp. 1000 un
R$
4,99
Mala WEST A\\CASA  - cada
Quant. Disp. 1000 un
DE: R$319,90
Café MELITTA Tradicional
Pacote 500g
Quant. Disp. 1000 un
DE: R$25,90
POR:
R$
22,90
ou 3x R$7,63
Cereal NESTLÉ - cada
Quant. Disp. 1000 un
Snow Flakes Caixa 230g
R$
6,99
Kitkat Caixa 210g
R$
11,99
48 9830-0000
Detergente YPÊ 500ml
Quant. Disp. 1000 un
R$ 2,79"""

    def test_validade(self):
        from encarte_pdf import validade
        self.assertEqual(validade(self.TEXTO), ("2026-11-19", "2026-11-22"))
        self.assertIsNone(validade("sem datas"))
        self.assertIsNone(validade("de 30/02/2026 a 22/11/2026"))

    def test_ofertas_limpas_com_de_por_e_variacoes(self):
        from encarte_pdf import ler_ofertas
        of = {o["name"]: o for o in ler_ofertas(self.TEXTO)}
        self.assertEqual(of["Cerveja SPATEN Puro Malte Lata 473ml"]["price"], 4.99)
        self.assertEqual(of["Café MELITTA Tradicional Pacote 500g"]["price"], 22.90)
        self.assertEqual(of["Café MELITTA Tradicional Pacote 500g"]["listPrice"], 25.90)
        self.assertEqual(of["Cereal NESTLÉ Snow Flakes Caixa 230g"]["price"], 6.99)
        self.assertEqual(of["Kitkat Caixa 210g"]["price"], 11.99)
        self.assertEqual(of["Detergente YPÊ 500ml"]["price"], 2.79)
        self.assertFalse(any("R$" in n or "/2026" in n or "9830" in n for n in of))        # sem lixo nos nomes
        self.assertNotIn("Mala WEST A\\CASA", of)                                         # oferta sem preço claro não entra

    def test_produtos_com_validade_e_categoria(self):
        from encarte_pdf import categoria_pelo_nome, em_produtos, ler_ofertas
        cat = categoria_pelo_nome([("cafe 500g", "Mercearia"), ("detergente", "Limpeza")])
        ps = em_produtos(ler_ofertas(self.TEXTO), "angeloni", "2026-11-22", "https://x/p.pdf", cat)
        cafe = next(p for p in ps if p["name"].startswith("Café"))
        self.assertEqual((cafe["category"], cafe["validUntil"], cafe["store"], cafe["promo"]), ("Mercearia", "2026-11-22", "angeloni", True))
        self.assertEqual(cafe["unitPrice"], 45.8)
        self.assertGreater(cafe["listPrice"], cafe["price"])
        self.assertEqual(next(p for p in ps if p["name"].startswith("Deterg"))["category"], "Limpeza")
        self.assertEqual(len({p["id"] for p in ps}), len(ps))


if __name__ == "__main__":
    unittest.main()
