import unittest

from prices import parse_size, unit_price, vtex_product
from scan import allowed, load_terms
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


if __name__ == "__main__":
    unittest.main()
