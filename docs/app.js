import { extractText, importFile } from './lib/import.js';
import { emProdutos, lerEncarte, vigentes } from './lib/encarte.js';
import { applyImport, mergeDuplicates, parseLine, parseText } from './lib/parse-list.js';
import { prepare } from './lib/match.js';
import { compute, consolidate } from './lib/basket.js';
import { buildCsv, buildText, groupOption, mailtoUrl, title as optTitle, whatsappUrl } from './lib/share.js';
import { CESTA_BASICA } from './lib/starter.js';
import { agrupar, validade } from './lib/encartes.js';
import { derivarItens, prepararBase, sugerir } from './lib/search.js';
import { filtrar, janela, paginar } from './lib/paginate.js';
import { bloqueado, entrar, tentativa } from './lib/auth.js';
import { ativos, mesclar, reconciliar } from './lib/lista-sync.js';
import { criarCliente, enderecoValido, novoToken } from './lib/sync-client.js';

const $ = (id) => document.getElementById(id);
const KEY_BASE = 'sms-list-v1';
const listKey = () => `${KEY_BASE}:${state.user || 'anon'}`;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const state = { sync: [], syncUrl: '', syncCli: null, syncTimer: null, user: null, serverProducts: [], baseStores: [], encPending: null, refreshing: false, base: null, sug: [], sugIdx: -1, rawProducts: [], encartes: [], encInfo: null, encStore: 'todos', apiOn: false, searching: new Set(), consK: 1, view: 'lista', out: null, list: [], products: [], stores: [], storeNames: {}, storeSites: {}, storeInfo: [], pending: null, selected: null, offerStore: 'todos' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- abas (uma seção por vez, sem rolar a página inteira)
const VIEWS = ['lista', 'comparar', 'consolidada', 'mercado', 'promocoes', 'catalogo', 'encartes', 'mercados'];
function showView(v, push = true) {
  if (!VIEWS.includes(v)) v = 'lista';
  state.view = v;
  for (const id of VIEWS) $('v-' + id).hidden = id !== v;
  for (const b of document.querySelectorAll('#nav button')) { const on = b.dataset.view === v; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on) b.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  if (push) { try { if (location.hash !== '#' + v) history.pushState(null, '', '#' + v); } catch { /* sem histórico */ } }
  window.scrollTo({ top: 0 });
}
function updateNav() {
  $('b-lista').textContent = state.list.length ? String(state.list.length) : '';
  const n = state.products.filter((p) => p.promo).length;
  $('b-promo').textContent = n ? String(n) : '';
  $('b-cat').textContent = state.products.length ? String(state.products.length) : '';
  $('b-enc').textContent = state.encartes.length ? String(state.encartes.length) : '';
}

/** Fotinho do produto (só https; sem enviar o endereço da página de origem). null se não tiver. */
function thumb(url, cls = 'thumb') {
  if (!url || !/^https:\/\//.test(url)) return null;
  const im = el('img', cls); im.src = url; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
  im.addEventListener('error', () => im.remove());
  return im;
}

// ---------- encartes importados (ofertas com validade, só neste navegador)
const KEY_ENC = 'sms-encarte-v1';
function readLocalEnc() {
  try { const r = JSON.parse(localStorage.getItem(KEY_ENC) || '[]'); return Array.isArray(r) ? r.filter((p) => p && typeof p.name === 'string' && p.price > 0 && p.validUntil) : []; } catch { return []; }
}
function writeLocalEnc(list) { try { localStorage.setItem(KEY_ENC, JSON.stringify(list)); } catch { /* sem armazenamento */ } }

/** Junta os preços coletados com as ofertas de encarte ainda válidas e registra os mercados que só têm encarte. */
function applyLocal() {
  const local = vigentes(readLocalEnc(), isoToday());
  writeLocalEnc(local);                                  // o vencido sai sozinho
  state.rawProducts = [...vigentes(state.serverProducts, isoToday()), ...local];   // oferta de encarte vencida sai, venha do servidor ou do navegador
  state.products = state.rawProducts.map(prepare);
  state.stores = [...new Set([...state.baseStores, ...local.map((p) => p.store)])];
  buildBase();
}

// ---------- persistência (só no navegador; se o armazenamento falhar, a lista vive só na página)
const syncKey = () => `sms-list-sync:${state.user || 'anon'}`;
const tokenKey = () => `sms-sync-token:${state.user || 'anon'}`;
function save() {
  state.sync = reconciliar(state.sync, state.list);   // marca o que mudou e guarda o que foi apagado, para a Alexa e o site concordarem
  try { localStorage.setItem(listKey(), JSON.stringify(state.list)); localStorage.setItem(syncKey(), JSON.stringify(state.sync)); } catch { /* sem armazenamento */ }
  agendarEnvio();
}
function restore() {
  try {
    // a lista que existia antes do login passa para o primeiro usuário (leandro), uma vez
    let txt = localStorage.getItem(listKey());
    if (txt === null && state.user === 'leandro') { txt = localStorage.getItem(KEY_BASE); if (txt !== null) localStorage.setItem(listKey(), txt); }
    const raw = JSON.parse(txt || '[]');
    if (Array.isArray(raw)) state.list = raw.filter((i) => i && typeof i.name === 'string' && i.qty > 0).map((i) => ({ name: i.name.slice(0, 80), qty: Math.min(Number(i.qty) || 1, 999) }));
  } catch { state.list = []; }
  try { const s = JSON.parse(localStorage.getItem(syncKey()) || '[]'); state.sync = Array.isArray(s) ? s : []; } catch { state.sync = []; }
  state.sync = reconciliar(state.sync, state.list);   // cobre listas guardadas antes da sincronização existir
}

// ---------- lista
function renderList() {
  const ul = $('list');
  ul.replaceChildren();
  state.list.forEach((it, i) => {
    const li = el('li');
    const qty = el('input');
    qty.type = 'number'; qty.min = '1'; qty.max = '999'; qty.value = String(it.qty); qty.setAttribute('aria-label', 'Quantidade de ' + it.name);
    qty.addEventListener('change', () => { const v = Math.max(1, Math.min(999, Math.round(Number(qty.value) || 1))); state.list[i].qty = v; qty.value = String(v); save(); renderResult(); });
    const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remover ' + it.name);
    x.addEventListener('click', () => { state.list.splice(i, 1); save(); renderAll(); });
    const nm = el('span', 'nm'); nm.append(document.createTextNode(it.name)); nm.append(el('span', 'cheap'));
    const ph = el('span', 'ph'); ph.dataset.i = String(i);
    li.append(qty, ph, nm, x);
    ul.append(li);
  });
  paintCheapest();
  $('list-empty').hidden = state.list.length > 0;
  $('clear').hidden = state.list.length === 0;
}

/** Ao lado de cada item da lista: em qual mercado ele está mais barato (e quanto). */
function paintCheapest() {
  document.querySelectorAll('#list li .ph').forEach((ph) => {
    ph.replaceChildren();
    const r = state.out && state.out.rows[Number(ph.dataset.i)];
    const m = r && r.best ? r.per[r.best.store] : null;
    const im = m ? thumb(m.product.image, 'thumb') : null;
    if (im) ph.append(im);
  });
  const spans = document.querySelectorAll('#list li .cheap');
  const rows = state.out ? state.out.rows : [];
  spans.forEach((sp, i) => {
    const r = rows[i];
    sp.replaceChildren();
    sp.className = 'cheap';
    if (!r || !state.stores.length) return;
    if (!r.best) { sp.classList.add('cheap--none'); sp.textContent = 'sem preço nos mercados'; return; }
    const m = r.per[r.best.store];
    sp.append(el('strong', '', state.storeNames[r.best.store] || r.best.store), document.createTextNode(` · ${brl.format(m.product.price)}${r.item.qty > 1 ? ` (${brl.format(r.best.sub)} no total)` : ''}`));
  });
}

function addItem(rawName, qtyIn) {
  const it = parseLine(`${rawName}`);
  if (!it) return;
  const qty = Math.max(1, Math.round(Number(qtyIn) || 1));
  state.list = mergeDuplicates([...state.list, { name: it.name, qty: qty * (it.qty || 1) }]);
  $('add-name').value = ''; $('add-qty').value = '1'; closeSug();
  save(); renderAll(); $('add-name').focus();
  const idx = state.list.findIndex((i) => i.name === it.name);
  if (idx >= 0 && needsSearch(idx)) { if (state.apiOn) searchItem(it.name); else addStatus(`"${it.name}" ainda não está no catálogo coletado.`); }
}
function addManual(e) { e.preventDefault(); const pick = state.sug[state.sugIdx]; addItem(pick ? pick.add : $('add-name').value.trim(), $('add-qty').value); }

// ---------- busca inteligente (sugestões enquanto digita)
function closeSug() { state.sug = []; state.sugIdx = -1; const u = $('sug'); u.hidden = true; u.replaceChildren(); $('add-name').setAttribute('aria-expanded', 'false'); $('add-name').removeAttribute('aria-activedescendant'); }
function renderSug() {
  const u = $('sug'); u.replaceChildren();
  if (!state.sug.length) { u.hidden = true; $('add-name').setAttribute('aria-expanded', 'false'); return; }
  state.sug.forEach((s, i) => {
    const li = el('li', 'sug__i'); li.id = 'sug-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === state.sugIdx));
    const t = el('span', 'sug__t', s.label);
    const m = el('span', 'sug__m', s.kind === 'item' ? `${s.category} · ${s.n} produtos${s.min ? ` · a partir de ${brl.format(s.min)}` : ''}` : `${state.storeNames[s.store] || s.store} · ${brl.format(s.price)}`);
    li.append(t, m);
    li.addEventListener('mousedown', (e) => { e.preventDefault(); addItem(s.add, $('add-qty').value); });
    u.append(li);
  });
  u.hidden = false; $('add-name').setAttribute('aria-expanded', 'true');
  if (state.sugIdx >= 0) $('add-name').setAttribute('aria-activedescendant', 'sug-' + state.sugIdx); else $('add-name').removeAttribute('aria-activedescendant');
}
function updateSug() {
  const q = $('add-name').value.trim();
  state.sug = state.base && q.length >= 2 ? sugerir(state.base, q, 8) : [];
  state.sugIdx = -1; renderSug();
}
function onSugKey(e) {
  if (!state.sug.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); state.sugIdx = (state.sugIdx + 1) % state.sug.length; renderSug(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); state.sugIdx = state.sugIdx <= 0 ? state.sug.length - 1 : state.sugIdx - 1; renderSug(); }
  else if (e.key === 'Escape') { closeSug(); }
}
function buildBase() { state.base = prepararBase(derivarItens(state.rawProducts), state.rawProducts); }

// ---------- importação
function status(msg, err = false) { const s = $('status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }
const mode = () => (document.querySelector('input[name=mode]:checked') || {}).value || 'add';

function showPreview(items) {
  if (!items.length) { status('Não encontrei itens nesse arquivo. Tente outra foto/arquivo ou digite a lista.', true); $('preview').hidden = true; return; }
  state.pending = items.map((i) => ({ ...i }));
  status(`${items.length} item(ns) lidos. Confira abaixo.`);
  const ul = $('plist');
  ul.replaceChildren();
  state.pending.forEach((it, i) => {
    const li = el('li');
    const qty = el('input'); qty.type = 'number'; qty.min = '1'; qty.max = '999'; qty.value = String(it.qty); qty.setAttribute('aria-label', 'Quantidade');
    qty.addEventListener('input', () => { it.qty = Math.max(1, Math.min(999, Math.round(Number(qty.value) || 1))); });
    const name = el('input', 'nm'); name.value = it.name; name.maxLength = 80; name.setAttribute('aria-label', 'Nome do item');
    name.addEventListener('input', () => { it.name = name.value; });
    const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remover da prévia');
    x.addEventListener('click', () => { state.pending.splice(state.pending.indexOf(it), 1); li.remove(); if (!state.pending.length) $('preview').hidden = true; });
    li.append(qty, name, x);
    ul.append(li);
  });
  $('apply').textContent = mode() === 'replace' ? 'Substituir a lista' : 'Adicionar à lista';
  $('preview').hidden = false;
}

async function onFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  try { status('Lendo…'); showPreview(await importFile(f, status)); }
  catch (e) { status(e.message || 'Não consegui ler o arquivo.', true); }
}

function applyPending() {
  const clean = (state.pending || []).map((i) => ({ name: String(i.name).trim().slice(0, 80), qty: i.qty })).filter((i) => i.name.length >= 2);
  state.list = applyImport(state.list, clean, mode());
  state.pending = null; $('preview').hidden = true;
  status(mode() === 'replace' ? 'Lista substituída.' : 'Itens adicionados à lista.');
  save(); renderAll();
}

// ---------- comparação
function renderResult() {
  const stores = state.stores;
  updateNav();
  if (!state.list.length || !stores.length) {
    state.out = null; paintCheapest();
    $('res-empty').hidden = false; $('res-body').hidden = true;
    renderStoreView(null); renderConsolidated();
    return;
  }
  $('res-empty').hidden = true; $('res-body').hidden = false;
  const out = compute(state.list, state.products, stores);
  state.out = out; paintCheapest();
  const priced = out.priced;
  const cheapest = Object.entries(out.totals).filter(([, t]) => priced > 0).sort((x, y) => x[1].full - y[1].full)[0];

  const tot = $('totals'); tot.replaceChildren();
  for (const s of stores) {
    const t = out.totals[s];
    const c = el('button', 'tot' + (cheapest && cheapest[0] === s ? ' best' : ''));
    c.type = 'button'; c.setAttribute('aria-pressed', String(state.selected === s));
    const has = t.found;
    c.append(el('span', 'tot__n', state.storeNames[s] || s), el('span', 'tot__v', brl.format(t.full)),
      el('span', 'tot__s', t.fill > 0 ? `${brl.format(t.total)} aqui (${has} itens) + ${brl.format(t.fill)} dos outros ${priced - has} em outros mercados` : `todos os ${has} itens neste mercado`),
      el('span', 'tot__go', 'Ver a lista deste mercado ›'));
    c.addEventListener('click', () => { state.selected = s; renderStoreView(state.out); showView('mercado'); });
    tot.append(c);
  }
  if (stores.length > 1) {
    const c = el('button', 'tot tot--mix'); c.type = 'button';
    c.append(el('span', 'tot__n', 'Mais barato misturando mercados'), el('span', 'tot__v', brl.format(out.mix.total)),
      el('span', 'tot__s', `cada um dos ${priced} itens no mais barato · exige mais de um lugar`),
      el('span', 'tot__go', 'Ver a lista de compras ›'));
    c.addEventListener('click', () => { state.consK = stores.length; renderConsolidated(); showView('consolidada'); });
    tot.append(c);
  }

  const head = $('thead'); head.replaceChildren();
  const hr = el('tr'); hr.append(el('th', '', 'Item'));
  for (const s of stores) hr.append(el('th', '', state.storeNames[s] || s));
  head.append(hr);
  const body = $('tbody'); body.replaceChildren();
  const missing = [];
  const rows = [...out.rows].sort((x, y) => x.category.localeCompare(y.category, 'pt-BR'));
  let lastCat = null;
  for (const r of rows) {
    if (r.category !== lastCat) {
      lastCat = r.category;
      const cr = el('tr', 'catrow'); const th = el('th', '', r.category); th.colSpan = stores.length + 1; cr.append(th); body.append(cr);
    }
    const tr = el('tr');
    const first = el('td'); first.append(document.createTextNode(`${r.item.qty}× ${r.item.name}`)); tr.append(first);
    let any = false;
    for (const s of stores) {
      const m = r.per[s];
      const td = el('td', r.best && r.best.store === s && stores.length > 1 ? 'best' : '');
      if (!m) td.append(el('span', 'na', '—'));
      else {
        any = true;
        const p = m.product;
        const wrap = el('div', 'pc'); const im = thumb(p.image, 'thumb'); if (im) wrap.append(im);
        const box = el('div', 'pc__t'); box.append(document.createTextNode(brl.format(p.price * r.item.qty)));
        const pn = el('span', 'pn');
        const a = el('a', '', p.name); a.href = /^https:\/\//.test(p.url) ? p.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        pn.append(a);
        pn.append(document.createTextNode(` · ${brl.format(p.price)}${p.unitPrice && p.size ? ` (${brl.format(p.unitPrice)}/${p.size.unit})` : ''}${p.listPrice > p.price ? ' · em oferta' : ''}${p.validUntil ? ` · encarte até ${p.validUntil.split('-').reverse().slice(0, 2).join('/')}` : ''}`));
        box.append(pn); wrap.append(box); td.append(wrap);
      }
      tr.append(td);
    }
    if (!any) missing.push(r.item.name);
    body.append(tr);
  }
  const nf = $('notfound');
  nf.hidden = missing.length === 0;
  nf.replaceChildren();
  if (missing.length) {
    nf.append(document.createTextNode('Sem preço em nenhum mercado (ainda não está no catálogo coletado): '));
    missing.forEach((name, i) => {
      if (i) nf.append(document.createTextNode(', '));
      nf.append(document.createTextNode(name + ' '));
      if (state.apiOn) { const b = el('button', 'link', '[buscar nos mercados]'); b.type = 'button'; b.addEventListener('click', () => searchItem(name)); nf.append(b); }
      else if (repo()) { const a2 = el('a', '', '[pedir inclusão]'); a2.href = requestUrl(name); a2.target = '_blank'; a2.rel = 'noopener noreferrer'; nf.append(a2); }
    });
  }
  renderStoreView(out);
  renderConsolidated();
}

function storeText(name, entries) {
  return [`Lista - ${name}`, ...entries.map((e) => `${e.item.qty}x ${e.product.name} - ${brl.format(e.sub)}`), `Total: ${brl.format(entries.reduce((s, e) => s + e.sub, 0))}`].join('\n');
}

async function copyText(btn, text) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copiada!'; }
  catch { const t = el('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); btn.textContent = 'Copiada!'; } catch { btn.textContent = 'Não consegui copiar'; } t.remove(); }
  setTimeout(() => { btn.textContent = 'Copiar lista'; }, 1800);
}

/** Texto de apoio de cada opção: onde comprar, o que o mercado não tem e a economia sobre comprar em 1 mercado (calculada sobre a lista inteira). */
function optionNote(o, base) {
  const nm = (s) => state.storeNames[s] || s;
  const names = o.stores.map(nm).join(' + ');
  const falta = o.uncovered.length ? ` · faltam ${o.uncovered.length} de ${o.universe} itens` : ` · todos os ${o.universe} itens`;
  const save = o !== base && o.saving > 0 ? ` · economiza ${brl.format(o.saving)}` : (o !== base ? ' · sem economia extra' : '');
  return `${names}${falta}${save}`;
}

function renderConsolidated() {
  if (!state.out || !state.stores.length) { $('cons-empty').hidden = false; $('cons-wrap').hidden = true; return; }
  const options = consolidate(state.out, state.stores, state.stores.length);
  if (!options.length) { $('cons-empty').hidden = false; $('cons-wrap').hidden = true; return; }
  $('cons-empty').hidden = true; $('cons-wrap').hidden = false;
  if (!options.some((o) => o.k === state.consK)) state.consK = 1;
  const opts = $('cons-opts'); opts.replaceChildren();
  for (const o of options) {
    const b = el('button', 'opt'); b.type = 'button'; b.setAttribute('aria-pressed', String(o.k === state.consK));
    b.append(el('span', 'opt__t', o.k === 1 ? 'Tudo em 1 mercado' : (o.k === state.stores.length && o.k > 3 ? 'Cada item no mais barato' : `Em até ${o.k} mercados`)), el('span', 'opt__v', brl.format(o.total)), 
      el('span', 'opt__s', optionNote(o, options[0])));
    b.addEventListener('click', () => { state.consK = o.k; renderConsolidated(); });
    opts.append(b);
  }
  const chosen = options.find((o) => o.k === state.consK);
  const body = $('cons-body'); body.replaceChildren();
  const notes = [];
  if (chosen.uncovered.length) notes.push(`${chosen.uncovered.length} de ${chosen.universe} itens não existem ${chosen.stores.length === 1 ? 'neste mercado' : 'nestes mercados'}; lista completa ≈ ${brl.format(chosen.fullEstimate)} comprando-os no mais barato de outro lugar.`);
  if (chosen.missing) notes.push(`${chosen.missing} item(ns) sem preço em nenhum mercado ficam de fora.`);
  if (notes.length) body.append(el('p', 'hint', notes.join(' ')));
  for (const s of chosen.stores) {
    const entries = [...chosen.assign[s]].sort((x, y) => x.category.localeCompare(y.category, 'pt-BR'));
    const sec = el('div', 'cons-store');
    const head = el('div', 'svhead'); head.append(el('h3', '', `${state.storeNames[s] || s} · ${brl.format(entries.reduce((t, e) => t + e.sub, 0))}`));
    const cp = el('button', 'link', 'Copiar lista'); cp.type = 'button'; cp.addEventListener('click', () => copyText(cp, storeText(state.storeNames[s] || s, entries))); head.append(cp);
    sec.append(head);
    let last = null;
    for (const e of entries) {
      if (e.category !== last) { last = e.category; sec.append(el('h4', 'sv-cat', e.category)); }
      const row = el('div', 'sv-item');
      const ph = thumb(e.product.image, 'thumb'); if (ph) row.append(ph);
      const l = el('div', 'l'); l.append(document.createTextNode(`${e.item.qty}× ${e.item.name}`));
      const a = el('a', '', e.product.name); a.href = /^https:\/\//.test(e.product.url) ? e.product.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      const pn = el('span', 'pn'); pn.style.marginLeft = '0'; pn.append(a); l.append(pn);
      const r = el('div', 'r'); r.append(document.createTextNode(brl.format(e.sub)), el('span', 'pn', `${brl.format(e.product.price)} cada`));
      row.append(l, r); sec.append(row);
    }
    body.append(sec);
  }
  if (chosen.uncovered.length) {
    const sec = el('div', 'cons-store cons-store--miss');
    sec.append(el('h3', '', `Não encontrados ${chosen.stores.length === 1 ? 'neste mercado' : 'nestes mercados'} (${chosen.uncovered.length})`));
    for (const u of chosen.uncovered) {
      const row = el('div', 'sv-item sv-miss'); const l = el('div', 'l'); l.append(document.createTextNode(`${u.item.qty}× ${u.item.name}`));
      l.append(el('span', 'pn', `mais barato em ${state.storeNames[u.elsewhere.store] || u.elsewhere.store}: ${brl.format(u.elsewhere.sub)}`));
      row.append(l); sec.append(row);
    }
    body.append(sec);
  }
  body.append(shareBar(chosen));
}

function renderStoreView(out) {
  if (!out || !state.stores.length) { $('sv-empty').hidden = false; $('sv-wrap').hidden = true; return; }
  $('sv-empty').hidden = true; $('sv-wrap').hidden = false;
  if (!state.selected || !state.stores.includes(state.selected)) {
    const best = Object.entries(out.totals).filter(([, t]) => t.found > 0).sort((x, y) => y[1].found - x[1].found || x[1].total - y[1].total)[0];
    state.selected = best ? best[0] : state.stores[0];
  }
  const s = state.selected;
  const name = state.storeNames[s] || s;
  const chips = $('sv-chips'); chips.replaceChildren();
  for (const id of state.stores) {
    const b = el('button', 'chip', `${state.storeNames[id] || id} · ${brl.format(out.totals[id].total)}`); b.type = 'button'; b.setAttribute('aria-pressed', String(id === s));
    b.addEventListener('click', () => { state.selected = id; renderStoreView(out); });
    chips.append(b);
  }
  const site = state.storeSites[s];
  const sub = $('sv-sub'); sub.replaceChildren(document.createTextNode(`Total ${brl.format(out.totals[s].total)} · ${out.totals[s].found} de ${state.list.length} itens com preço. `));
  if (site && /^https:\/\//.test(site)) { const a = el('a', '', 'Abrir o site do mercado'); a.href = site; a.target = '_blank'; a.rel = 'noopener noreferrer'; sub.append(a); }
  const body = $('sv-body'); body.replaceChildren();
  const byCat = new Map();
  for (const r of out.rows) { const k = r.category; byCat.set(k, [...(byCat.get(k) || []), r]); }
  for (const cat of [...byCat.keys()].sort((x, y) => x.localeCompare(y, 'pt-BR'))) {
    body.append(el('h3', 'sv-cat', cat));
    for (const r of byCat.get(cat)) {
      const m = r.per[s];
      const row = el('div', 'sv-item');
      if (m && m.product.image && /^https:\/\//.test(m.product.image)) { const im = el('img'); im.src = m.product.image; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; row.append(im); }
      const l = el('div', 'l');
      l.append(document.createTextNode(`${r.item.qty}× ${r.item.name}`));
      const rt = el('div', 'r');
      if (!m) { l.classList.add('sv-miss'); l.append(el('span', 'pn', 'sem preço neste mercado')); rt.textContent = '—'; }
      else {
        const p = m.product;
        const a = el('a', '', p.name); a.href = /^https:\/\//.test(p.url) ? p.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        const pn = el('span', 'pn'); pn.style.marginLeft = '0'; pn.append(a); l.append(pn);
        rt.append(document.createTextNode(brl.format(p.price * r.item.qty)), el('span', 'pn', `${brl.format(p.price)} cada${p.promo ? ' · em oferta' : ''}`));
      }
      row.append(l, rt); body.append(row);
    }
  }
}

const GRIDS = {};
const POR_PAGINA = 24;
const nomesOrdem = { desconto: 'Maior desconto', menor: 'Menor preço', maior: 'Maior preço', nome: 'Nome (A–Z)' };

/** Grade de produtos com busca, mercado, categoria, ordenação e páginas. `id` é o contêiner; `base()` devolve os produtos de partida. */
function renderGrid(id, base, ordemPadrao) {
  const g = (GRIDS[id] ||= { store: 'todos', cat: 'todas', q: '', ordem: ordemPadrao, page: 1, built: false });
  const root = $(id);
  const todos = base();
  const cats = [...new Set(todos.map((p) => p.category || 'Outros'))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  if (!g.built) {
    root.replaceChildren();
    const bar = el('div', 'gbar');
    const q = el('input'); q.type = 'search'; q.placeholder = 'Buscar produto ou marca…'; q.setAttribute('aria-label', 'Buscar produto ou marca'); q.maxLength = 60;
    q.addEventListener('input', () => { g.q = q.value; g.page = 1; renderGrid(id, base, ordemPadrao); });
    const selCat = el('select'); selCat.setAttribute('aria-label', 'Categoria'); selCat.dataset.k = 'cat';
    selCat.addEventListener('change', () => { g.cat = selCat.value; g.page = 1; renderGrid(id, base, ordemPadrao); });
    const selOrd = el('select'); selOrd.setAttribute('aria-label', 'Ordenar por');
    for (const [v, l] of Object.entries(nomesOrdem)) { const o = el('option', '', l); o.value = v; selOrd.append(o); }
    selOrd.value = g.ordem; selOrd.addEventListener('change', () => { g.ordem = selOrd.value; g.page = 1; renderGrid(id, base, ordemPadrao); });
    bar.append(q, selCat, selOrd);
    const chips = el('div', 'chips'); chips.dataset.k = 'chips'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Filtrar por mercado');
    const cnt = el('p', 'hint'); cnt.dataset.k = 'count'; cnt.setAttribute('aria-live', 'polite');
    const ul = el('ul', 'cards'); ul.dataset.k = 'list';
    const pager = el('nav', 'pager'); pager.dataset.k = 'pager'; pager.setAttribute('aria-label', 'Páginas');
    root.append(bar, chips, cnt, ul, pager);
    g.built = true;
  }
  const sel = root.querySelector('select[data-k=cat]'); const keep = g.cat;
  sel.replaceChildren(); const all = el('option', '', 'Todas as categorias'); all.value = 'todas'; sel.append(all);
  for (const c of cats) { const o = el('option', '', c); o.value = c; sel.append(o); }
  sel.value = cats.includes(keep) ? keep : 'todas'; g.cat = sel.value;

  const lista = filtrar(todos, { store: g.store, cat: g.cat, q: g.q, ordem: g.ordem });
  const pg = paginar(lista, g.page, POR_PAGINA); g.page = pg.page;

  const chips = root.querySelector('[data-k=chips]'); chips.replaceChildren();
  const porLoja = (s) => filtrar(todos, { store: s, cat: g.cat, q: g.q }).length;
  for (const [sid, label] of [['todos', 'Todos'], ...state.stores.map((s) => [s, state.storeNames[s] || s])]) {
    const n = porLoja(sid); if (sid !== 'todos' && !todos.some((p) => p.store === sid)) continue;
    const b = el('button', 'chip', `${label} (${n})`); b.type = 'button'; b.setAttribute('aria-pressed', String(g.store === sid));
    b.addEventListener('click', () => { g.store = sid; g.page = 1; renderGrid(id, base, ordemPadrao); });
    chips.append(b);
  }
  const ini = pg.total ? (pg.page - 1) * POR_PAGINA + 1 : 0;
  root.querySelector('[data-k=count]').textContent = pg.total ? `Mostrando ${ini}–${ini + pg.items.length - 1} de ${pg.total} produtos` : 'Nenhum produto com esses filtros.';

  const ul = root.querySelector('[data-k=list]'); ul.replaceChildren();
  const off = (p) => (p.listPrice > p.price ? Math.round((1 - p.price / p.listPrice) * 100) : 0);
  for (const p of pg.items) {
    const li = el('li', 'card');
    const im = thumb(p.image, 'thumb thumb--lg'); if (im) li.append(im);
    const b = el('div', 'card__b');
    const a = el('a', 'card__n', p.name); a.href = /^https:\/\//.test(p.url) ? p.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const pr = el('span', 'card__p', brl.format(p.price));
    if (p.listPrice > p.price) pr.append(el('span', 'card__old', brl.format(p.listPrice)));
    b.append(a, pr);
    if (off(p)) b.append(el('span', 'card__off', `-${off(p)}%`)); else if (p.promo) b.append(el('span', 'card__off', 'em oferta'));
    const meta = [state.storeNames[p.store] || p.store, p.validUntil ? `encarte até ${p.validUntil.split('-').reverse().slice(0, 2).join('/')}` : '', p.category, p.unitPrice && p.size ? `${brl.format(p.unitPrice)}/${p.size.unit}` : ''].filter(Boolean).join(' · ');
    b.append(el('span', 'card__s', meta));
    li.append(b); ul.append(li);
  }
  const pager = root.querySelector('[data-k=pager]'); pager.replaceChildren();
  if (pg.pages > 1) {
    const go = (n) => { g.page = n; renderGrid(id, base, ordemPadrao); root.scrollIntoView({ block: 'start' }); };
    const prev = el('button', 'chip', '‹ Anterior'); prev.type = 'button'; prev.disabled = pg.page === 1; prev.addEventListener('click', () => go(pg.page - 1));
    pager.append(prev);
    for (const n of janela(pg.page, pg.pages)) {
      if (n === '…') { pager.append(el('span', 'pager__gap', '…')); continue; }
      const b = el('button', 'chip', String(n)); b.type = 'button'; b.setAttribute('aria-pressed', String(n === pg.page)); if (n === pg.page) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', () => go(n)); pager.append(b);
    }
    const next = el('button', 'chip', 'Próxima ›'); next.type = 'button'; next.disabled = pg.page === pg.pages; next.addEventListener('click', () => go(pg.page + 1));
    pager.append(next);
  }
}

function renderOffers() {
  updateNav();
  const promos = () => state.products.filter((p) => p.promo);
  if (!promos().length) { $('of-empty').hidden = false; $('of-wrap').hidden = true; return; }
  $('of-empty').hidden = true; $('of-wrap').hidden = false;
  renderGrid('of-grid', promos, 'desconto');
  renderCatalog();
}

function renderCatalog() {
  if (!state.products.length) { $('cat-empty').hidden = false; $('cat-wrap').hidden = true; return; }
  $('cat-empty').hidden = true; $('cat-wrap').hidden = false;
  renderGrid('cat-grid', () => state.products, 'nome');
}

// ---------- encartes (folhetos vigentes de cada rede)
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function renderEncartes() {
  updateNav();
  const items = state.encartes;
  if (!items.length) { $('enc-empty').hidden = false; $('enc-wrap').hidden = true; return; }
  $('enc-empty').hidden = true; $('enc-wrap').hidden = false;
  const names = Object.fromEntries((state.encInfo?.stores || []).map((s) => [s.store, s.name]));
  const groups = agrupar(items, names);
  const when = state.encInfo?.generatedAt ? new Date(state.encInfo.generatedAt).toLocaleString('pt-BR') : '';
  $('enc-sub').textContent = `${items.length} encartes vigentes${when ? ` · atualizados em ${when}` : ''} · fonte: ${state.encInfo?.source || 'Tiendeo'}. Toque num encarte para abrir o folheto no site da fonte.`;
  const chips = $('enc-chips'); chips.replaceChildren();
  for (const [id, label, n] of [['todos', 'Todos', items.length], ...groups.map((g) => [g.store, g.name, g.items.length])]) {
    const b = el('button', 'chip', `${label} (${n})`); b.type = 'button'; b.setAttribute('aria-pressed', String(state.encStore === id));
    b.addEventListener('click', () => { state.encStore = id; renderEncartes(); });
    chips.append(b);
  }
  const list = $('enc-list'); list.replaceChildren();
  const today = isoToday();
  for (const g of groups.filter((x) => state.encStore === 'todos' || x.store === state.encStore)) {
    list.append(el('h3', 'sv-cat', g.name));
    const links = (state.encInfo?.stores || []).find((s) => s.store === g.store)?.links || [];
    if (links.length) {
      const p = el('p', 'hint');
      links.forEach((l, i) => { if (i) p.append(document.createTextNode(' · ')); const a = el('a', '', l.label); a.href = /^https:\/\//.test(l.url) ? l.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); });
      list.append(p);
    }
    const ul = el('ul', 'cards cards--enc');
    for (const e of g.items) {
      const li = el('li', 'card card--enc');
      const a = el('a', 'enc'); a.href = /^https:\/\//.test(e.url) ? e.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
      if (e.image && /^https:\/\//.test(e.image)) { const im = el('img'); im.src = e.image; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; a.append(im); }
      const b = el('div', 'card__b');
      b.append(el('span', 'card__n', e.title), el('span', 'card__off', validade(e, today)), el('span', 'card__s', e.active === false ? 'ainda não começou' : 'vigente'));
      a.append(b); li.append(a); ul.append(li);
    }
    list.append(ul);
  }
}

function encStatus(msg, err = false) { const s = $('enc-status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }

function renderEncImport() {
  const sel = $('enc-store');
  if (!sel.options.length) {
    const ids = Object.keys(state.storeNames);
    ids.sort((x, y) => (x === 'imperatriz' ? -1 : y === 'imperatriz' ? 1 : (state.storeNames[x] || x).localeCompare(state.storeNames[y] || y, 'pt-BR')));
    for (const id of ids) { const o = el('option', '', state.storeNames[id] || id); o.value = id; sel.append(o); }
  }
  if (!$('enc-until').value) { const d = new Date(); d.setDate(d.getDate() + 7); $('enc-until').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  const box = $('enc-saved'); box.replaceChildren();
  const saved = readLocalEnc();
  if (!saved.length) return;
  const by = new Map();
  for (const p of saved) by.set(`${p.store}|${p.validUntil}`, [...(by.get(`${p.store}|${p.validUntil}`) || []), p]);
  box.append(el('h3', '', 'Ofertas de encarte na comparação'));
  for (const [k, list] of by) {
    const [store, until] = k.split('|');
    const row = el('div', 'sv-item');
    const l = el('div', 'l'); l.append(document.createTextNode(`${state.storeNames[store] || store} · ${list.length} ofertas · válidas até ${until.split('-').reverse().join('/')}`));
    const rm = el('button', 'link', 'Remover'); rm.type = 'button';
    rm.addEventListener('click', () => { writeLocalEnc(readLocalEnc().filter((p) => !(p.store === store && p.validUntil === until))); applyLocal(); renderAll(); renderOffers(); renderEncImport(); renderStoresFromState(); });
    row.append(l, rm); box.append(row);
  }
}

async function onEncFiles(input) {
  const files = [...(input.files || [])]; input.value = '';
  if (!files.length) return;
  try {
    let text = '';
    for (let i = 0; i < files.length; i++) text += '\n' + await extractText(files[i], (m) => encStatus(`${files.length > 1 ? `Arquivo ${i + 1} de ${files.length} · ` : ''}${m}`));
    const found = lerEncarte(text);
    if (!found.length) { encStatus('Não encontrei ofertas com preço. Tente uma foto mais nítida ou o PDF do encarte.', true); $('enc-prev').hidden = true; return; }
    state.encPending = found.map((o) => ({ ...o }));
    encStatus(`${found.length} ofertas lidas. Confira abaixo.`);
    const ul = $('enc-plist'); ul.replaceChildren();
    for (const o of state.encPending) {
      const li = el('li');
      const price = el('input'); price.type = 'number'; price.step = '0.01'; price.min = '0.01'; price.max = '999.99'; price.value = o.price.toFixed(2); price.setAttribute('aria-label', 'Preço');
      price.addEventListener('input', () => { o.price = parseFloat(price.value) || 0; });
      const name = el('input', 'nm'); name.value = o.name; name.maxLength = 90; name.setAttribute('aria-label', 'Produto'); name.addEventListener('input', () => { o.name = name.value; });
      const x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remover'); x.addEventListener('click', () => { state.encPending.splice(state.encPending.indexOf(o), 1); li.remove(); if (!state.encPending.length) $('enc-prev').hidden = true; });
      li.append(price, name, x); ul.append(li);
    }
    $('enc-prev').hidden = false;
  } catch (e) { encStatus(e.message || 'Não consegui ler o arquivo.', true); }
}

function applyEnc() {
  const until = $('enc-until').value; const store = $('enc-store').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < isoToday()) { encStatus('Informe a data de validade do encarte (hoje ou depois).', true); return; }
  const categoria = (n) => { const s = state.base ? sugerir(state.base, n, 1)[0] : null; return (s && s.category) || 'Outros'; };
  const novos = emProdutos((state.encPending || []).filter((o) => o.price > 0 && o.name.trim().length >= 3), { store, validUntil: until, categoria });
  if (!novos.length) { encStatus('Nenhuma oferta válida para adicionar.', true); return; }
  writeLocalEnc([...readLocalEnc().filter((p) => !(p.store === store && p.validUntil === until)), ...novos]);
  state.encPending = null; $('enc-prev').hidden = true;
  applyLocal(); renderAll(); renderOffers(); renderEncImport(); renderStoresFromState();
  encStatus(`${novos.length} ofertas adicionadas à comparação, válidas até ${until.split('-').reverse().join('/')}.`);
}

async function loadEncartes() {
  try {
    const ctl = new AbortController(); const tmo = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch('data/encartes.json', { cache: 'no-store', signal: ctl.signal }); clearTimeout(tmo);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) throw new Error('arquivo inválido');
    state.encInfo = data;
    state.encartes = data.items.filter((e) => e && typeof e.title === 'string' && e.start && e.end);
  } catch { state.encartes = []; }
  renderEncartes();
  renderEncImport();
}

function renderStats(data, hours) {
  const box = $('stats'); box.replaceChildren();
  const ok = data.stores.filter((s) => s.status === 'ok').length;
  for (const [v, l] of [[ok, ok === 1 ? 'mercado' : 'mercados'], [data.products.length, 'produtos'], [data.products.filter((p) => p.promo).length, 'promoções'], [hours < 1 ? '< 1 h' : `${hours} h`, 'desde a coleta']]) {
    const c = el('div', 'stat'); c.append(el('strong', '', String(v)), el('span', '', l)); box.append(c);
  }
}

function renderStoresFromState() { if (state.storeInfo) renderStores({ stores: state.storeInfo }); }

function renderStores(data) {
  const ul = $('storelist'); ul.replaceChildren();
  for (const s of data.stores) {
    const li = el('li');
    const enc = readLocalEnc().filter((p) => p.store === s.id);
    const encTxt = enc.length ? `${enc.length} ofertas de encarte (até ${enc[0].validUntil.split('-').reverse().slice(0, 2).join('/')})` : '';
    const label = s.status === 'ok' ? `${s.name}: ${s.products} produtos coletados${encTxt ? ` + ${encTxt}` : ''}` : `${s.name}: ${encTxt ? encTxt : (s.status === 'indisponivel' ? 'sem coleta automática (sem preço público): importe o encarte na aba Encartes para entrar na comparação' : `indisponível (${s.reason || s.status})`)}`;
    li.append(document.createTextNode(label + (s.reason && s.status === 'ok' ? ` · ${s.reason}` : '') + ' · '));
    if (s.site && /^https:\/\//.test(s.site)) { const a = el('a', '', 'site'); a.href = s.site; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); }
    ul.append(li);
  }
}

// ---------- compartilhar a lista consolidada
const todayLabel = () => new Date().toLocaleDateString('pt-BR');
function download(name, blob) { const u = URL.createObjectURL(blob); const a = el('a'); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }

/** Desenha a lista num canvas e devolve um PNG (para copiar ou baixar como imagem). */
function renderImage(option) {
  const groups = groupOption(option, state.storeNames);
  const W = 860, pad = 32, line = 26;
  const rows = [];
  rows.push({ t: 'Lista de compras', s: 'title' }, { t: `${optTitle(option)} · total ${brl.format(option.total)} · ${todayLabel()}`, s: 'sub' });
  for (const g of groups) {
    rows.push({ t: `${g.store} — ${brl.format(g.total)}`, s: 'store' });
    for (const grp of g.groups) { rows.push({ t: grp.category, s: 'cat' }); for (const e of grp.entries) rows.push({ t: `${e.qty}x ${e.name}`, r: brl.format(e.sub), s: 'item' }); }
  }
  rows.push({ t: 'Preços da loja virtual de cada mercado; confira antes de comprar.', s: 'foot' });
  const H = pad * 2 + rows.reduce((h, r) => h + (r.s === 'title' ? 44 : r.s === 'store' ? 44 : line), 0);
  const scale = 2, c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale;
  const g = c.getContext('2d'); g.scale(scale, scale);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  let y = pad;
  const fit = (txt, max) => { let s = txt; while (g.measureText(s).width > max && s.length > 4) s = s.slice(0, -2); return s === txt ? s : s + '…'; };
  for (const r of rows) {
    if (r.s === 'title') { g.fillStyle = '#0a5f42'; g.font = '700 28px system-ui, sans-serif'; g.fillText(r.t, pad, y + 28); y += 44; }
    else if (r.s === 'sub') { g.fillStyle = '#5a6a62'; g.font = '15px system-ui, sans-serif'; g.fillText(r.t, pad, y + 16); y += line; }
    else if (r.s === 'store') { g.fillStyle = '#0b7a53'; g.fillRect(pad, y + 6, W - pad * 2, 32); g.fillStyle = '#fff'; g.font = '700 17px system-ui, sans-serif'; g.fillText(r.t, pad + 12, y + 28); y += 44; }
    else if (r.s === 'cat') { g.fillStyle = '#0a5f42'; g.font = '700 12px system-ui, sans-serif'; g.fillText(r.t.toUpperCase(), pad, y + 17); y += line; }
    else if (r.s === 'item') { g.fillStyle = '#15201a'; g.font = '15px system-ui, sans-serif'; g.fillText(fit(r.t, W - pad * 2 - 130), pad + 8, y + 17); g.textAlign = 'right'; g.fillText(r.r, W - pad, y + 17); g.textAlign = 'left'; y += line; }
    else { g.fillStyle = '#5a6a62'; g.font = '12px system-ui, sans-serif'; g.fillText(r.t, pad, y + 16); y += line; }
  }
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('sem imagem'))), 'image/png'));
}

function shareBar(option) {
  const text = buildText(option, state.storeNames, brl, todayLabel());
  const bar = el('div', 'share');
  bar.append(el('h3', '', 'Compartilhar esta lista'));
  const row = el('div', 'share__row');
  const flash = (btn, ok, base) => { btn.textContent = ok; setTimeout(() => { btn.textContent = base; }, 1800); };
  const add = (label, fn, href) => {
    const isLink = !!href;
    const b = el(isLink ? 'a' : 'button', 'btn btn--ghost', label);
    if (isLink) { b.href = href; b.target = '_blank'; b.rel = 'noopener noreferrer'; } else { b.type = 'button'; b.addEventListener('click', () => fn(b)); }
    row.append(b); return b;
  };
  add('WhatsApp', null, whatsappUrl(text));
  add('E-mail', null, mailtoUrl(`Lista de compras ${todayLabel()}`, text));
  add('Copiar texto', async (b) => { await copyText(b, text); b.textContent = 'Copiado!'; setTimeout(() => { b.textContent = 'Copiar texto'; }, 1800); });
  add('Baixar TXT', () => download('lista-de-compras.txt', new Blob([text], { type: 'text/plain;charset=utf-8' })));
  add('Baixar planilha', () => download('lista-de-compras.csv', new Blob([buildCsv(option, state.storeNames)], { type: 'text/csv;charset=utf-8' })));
  add('Baixar imagem', async (b) => { try { download('lista-de-compras.png', await renderImage(option)); } catch { flash(b, 'Não consegui', 'Baixar imagem'); } });
  add('Copiar imagem', async (b) => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderImage(option) })]); flash(b, 'Imagem copiada!', 'Copiar imagem'); }
    catch { try { download('lista-de-compras.png', await renderImage(option)); flash(b, 'Baixei a imagem', 'Copiar imagem'); } catch { flash(b, 'Não consegui', 'Copiar imagem'); } }
  });
  add('Imprimir / PDF', () => window.print());
  if (navigator.share) add('Mais opções…', async () => { try { await navigator.share({ title: 'Lista de compras', text }); } catch { /* cancelou */ } });
  bar.append(row);
  return bar;
}

// ---------- item novo: procurar em todos os mercados cadastrados
const repo = () => (document.querySelector('meta[name=repo]') || {}).content || '';
function requestUrl(name) {
  const t = encodeURIComponent(`Termo: ${name}`);
  return `https://github.com/${repo()}/issues/new?title=${t}&labels=novo-termo&body=${encodeURIComponent('Incluir este item na coleta de preços dos mercados.')}`;
}
function addStatus(msg, err = false) { const s = $('add-status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }

/** Busca o item em TODOS os mercados, em segundo plano: a API cria a busca (threads, um por mercado) e a tela só acompanha, sem travar. */
async function searchItem(name) {
  if (!state.apiOn || state.searching.has(name)) return;
  state.searching.add(name);
  const have = new Set(state.products.map((p) => p.id));
  const merge = (list) => { const fresh = (list || []).filter((p) => !have.has(p.id)); fresh.forEach((p) => have.add(p.id)); if (fresh.length) { state.products.push(...fresh.map(prepare)); renderAll(); renderOffers(); } return fresh.length; };
  try {
    addStatus(`Procurando "${name}" nos mercados (em segundo plano)…`);
    const start = await fetch('api/search?q=' + encodeURIComponent(name), { cache: 'no-store' });
    const job = await start.json();
    if (!start.ok) throw new Error(job.error || 'HTTP ' + start.status);
    let total = 0;
    for (let i = 0; i < 150; i++) {            // até ~2,5 min, uma consulta por segundo
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch('api/job?id=' + encodeURIComponent(job.id), { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'HTTP ' + res.status);
      total += merge(j.products);
      const parts = Object.values(j.stores).map((s) => `${s.name}: ${s.status === 'ok' ? s.count : s.status}`);
      addStatus(`${j.status === 'done' ? 'Pronto' : 'Procurando'} "${name}" · ${parts.join(' · ')}`, false);
      if (j.status === 'done') break;
    }
    if (!total) addStatus(`Não achei "${name}" nos mercados cadastrados.`, true);
  } catch (e) { addStatus(`Não consegui buscar "${name}": ${e.message}`, true); }
  finally { state.searching.delete(name); }
}

function needsSearch(i) { const r = state.out && state.out.rows[i]; return !!state.out && !!r && !r.best; }

/** Testa a API em segundo plano, com prazo de 2 s: nunca segura o carregamento dos preços. */
// ---------- atualizar a base (coleta completa em segundo plano, com porcentagem)
function paintRefresh(v) {
  const prog = $('refresh-prog'), bar = $('refresh-bar'), txt = $('refresh-txt'), btn = $('refresh-btn');
  const running = v.status === 'running';
  btn.disabled = running; prog.hidden = !(running || v.status === 'done');
  const pct = Math.max(0, Math.min(100, Math.round(v.percent || 0)));
  bar.style.width = pct + '%'; bar.setAttribute('aria-valuenow', String(pct));
  if (running) {
    const parts = Object.values(v.stores || {}).map((s) => `${s.name} ${Math.min(100, Math.round((s.done / s.total) * 100))}%`);
    txt.textContent = `Atualizando… ${pct}% · ${parts.join(' · ')}`;
  } else if (v.status === 'error') { txt.textContent = `Não consegui atualizar: ${v.message || 'erro'}`; }
}

async function reloadData() { await loadPrices(); await loadEncartes(); renderAll(); renderOffers(); }

/** Acompanha a atualização (uma consulta por segundo) e, ao terminar, recarrega preços e encartes sem recarregar a página. */
async function followRefresh() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    for (let i = 0; i < 3600; i++) {
      const res = await fetch('api/refresh/status', { cache: 'no-store' });
      const v = await res.json();
      paintRefresh(v);
      if (v.status === 'done') {
        await reloadData();
        $('refresh-txt').textContent = `Base atualizada: ${v.products ?? ''} produtos · ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        setTimeout(() => { if (!state.refreshing) $('refresh-prog').hidden = true; }, 6000);
        break;
      }
      if (v.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) { $('refresh-txt').textContent = `Perdi a conexão com a atualização: ${e.message}`; }
  finally { state.refreshing = false; $('refresh-btn').disabled = false; }
}

async function startRefresh() {
  $('refresh-btn').disabled = true; $('refresh-txt').textContent = 'Iniciando…';
  try {
    const res = await fetch('api/refresh', { method: 'POST', cache: 'no-store' });
    const v = await res.json();
    if (!res.ok && res.status !== 409) throw new Error(v.error || 'HTTP ' + res.status);
    paintRefresh(v); followRefresh();
  } catch (e) { $('refresh-txt').textContent = `Não consegui iniciar: ${e.message}`; $('refresh-btn').disabled = false; }
}

async function probeApi() {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch('api/health', { cache: 'no-store', signal: ctl.signal }); clearTimeout(t);
    state.apiOn = r.ok && (await r.json()).ok === true;
  } catch { state.apiOn = false; }
  if (state.apiOn) {
    renderResult();   // os botões "buscar nos mercados" aparecem quando a API responde
    $('refresh').hidden = false;
    try { const v = await (await fetch('api/refresh/status', { cache: 'no-store' })).json(); if (v.status === 'running') { paintRefresh(v); followRefresh(); } } catch { /* sem status */ }
  }
}

function renderAll() { renderList(); renderResult(); }

async function loadPrices() {
  try {
    const ctl = new AbortController(); const tmo = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch('data/prices.json', { cache: 'no-store', signal: ctl.signal }); clearTimeout(tmo);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.stores)) throw new Error('arquivo de dados inválido');
    state.serverProducts = data.products;
    const ok = data.stores.filter((s) => s.status === 'ok');
    state.baseStores = ok.map((s) => s.id);
    state.storeNames = Object.fromEntries(data.stores.map((s) => [s.id, s.name]));
    state.storeSites = Object.fromEntries(data.stores.map((s) => [s.id, s.site]));
    state.storeInfo = data.stores;
    applyLocal();
    renderEncImport();   // o seletor de mercado do encarte precisa dos nomes dos mercados
    const when = new Date(data.generatedAt);
    const hours = Math.round((Date.now() - when.getTime()) / 36e5);
    $('meta').textContent = `Preços coletados em ${when.toLocaleString('pt-BR')} (há ${hours < 1 ? 'menos de 1 h' : hours + ' h'}) · ${data.region} · ${state.products.length} produtos`;
    renderStats(data, hours);
    renderStores(data);
    renderResult();
    renderOffers();
  } catch (e) {
    console.error(e);
    $('meta').textContent = '';
    const err = $('error'); err.hidden = false;
    err.textContent = `Não foi possível carregar os preços (${e.message}). Rodando localmente? Execute "make scan" para gerar o arquivo de preços.`;
  }
}

$('refresh-btn').addEventListener('click', startRefresh);
$('enc-files').addEventListener('change', (e) => onEncFiles(e.target));
$('enc-cam').addEventListener('change', (e) => onEncFiles(e.target));
$('enc-apply').addEventListener('click', applyEnc);
$('enc-cancel').addEventListener('click', () => { state.encPending = null; $('enc-prev').hidden = true; encStatus(''); });
$('add').addEventListener('submit', addManual);
$('add-name').addEventListener('input', updateSug);
$('add-name').addEventListener('keydown', onSugKey);
$('add-name').addEventListener('blur', () => setTimeout(closeSug, 120));
$('file').addEventListener('change', (e) => onFile(e.target));
$('photo').addEventListener('change', (e) => onFile(e.target));
function loadStarter() { showPreview(CESTA_BASICA.map((i) => ({ ...i }))); $('import').open = true; $('preview').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
$('starter').addEventListener('click', loadStarter);
$('starter2').addEventListener('click', loadStarter);
$('read-paste').addEventListener('click', () => { const items = parseText($('paste').value); showPreview(items); });
$('apply').addEventListener('click', applyPending);
$('cancel').addEventListener('click', () => { state.pending = null; $('preview').hidden = true; status(''); });
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => { if (!$('preview').hidden) $('apply').textContent = mode() === 'replace' ? 'Substituir a lista' : 'Adicionar à lista'; });
$('open-cons').addEventListener('click', () => showView('consolidada'));
for (const b of document.querySelectorAll('#nav button')) b.addEventListener('click', () => showView(b.dataset.view));
window.addEventListener('popstate', () => showView(location.hash.slice(1), false));
$('clear').addEventListener('click', () => { state.list = []; save(); renderAll(); });

// ---------- sincronização com a Alexa (só se data/config.json tiver o endereço do Worker)
function tokenSalvo() { try { return localStorage.getItem(tokenKey()) || ''; } catch { return ''; } }
function cliente() {
  const t = tokenSalvo();
  if (!state.syncUrl || !t) return null;
  state.syncCli ||= criarCliente({ url: state.syncUrl, token: t });
  return state.syncCli;
}
let envioPendente = null;
function agendarEnvio() {
  if (!cliente()) return;
  clearTimeout(envioPendente);
  envioPendente = setTimeout(() => { sincronizar(true); }, 1200);
}
/** Troca a lista com o Worker: manda a nossa, recebe a mesclada (inclui o que a Alexa adicionou) e atualiza a tela se mudou. */
async function sincronizar(enviar) {
  const c = cliente();
  if (!c || !state.user) return;
  try {
    const remoto = enviar ? await c.push(state.sync) : await c.pull();
    const juntos = mesclar(state.sync, remoto);
    const antes = JSON.stringify(ativos(state.sync).map((i) => [i.name, i.qty]));
    state.sync = juntos;
    state.list = ativos(juntos).map((i) => ({ name: i.name, qty: i.qty }));
    try { localStorage.setItem(listKey(), JSON.stringify(state.list)); localStorage.setItem(syncKey(), JSON.stringify(state.sync)); } catch { /* sem armazenamento */ }
    if (JSON.stringify(ativos(juntos).map((i) => [i.name, i.qty])) !== antes) { renderAll(); }
    if (!enviar && JSON.stringify(juntos) !== JSON.stringify(remoto)) await c.push(state.sync);   // devolve o que só nós temos
  } catch (e) { if (e.status === 401) alexaStatus('A ligação com a lista expirou. Gere um novo código.', true); }
}
function iniciarSincronizacao() {
  if (!state.syncUrl) return;
  $('alexa').hidden = false;
  paintAlexa();
  if (!cliente()) return;
  sincronizar(false);
  clearInterval(state.syncTimer);
  state.syncTimer = setInterval(() => { if (!document.hidden) sincronizar(false); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizar(false); });
}
function alexaStatus(msg, err = false) { const s = $('alexa-status'); s.textContent = msg; s.className = 'status' + (err ? ' err' : ''); }
function paintAlexa() { $('alexa-off').hidden = !tokenSalvo(); }

async function gerarCodigo() {
  try {
    if (!tokenSalvo()) { try { localStorage.setItem(tokenKey(), novoToken()); } catch { alexaStatus('Este navegador não guarda dados; não dá para ligar a Alexa.', true); return; } state.syncCli = null; }
    const c = cliente();
    await c.push(state.sync);                      // já sobe a lista atual, para a Alexa ler na hora
    const { code } = await c.pairStart();
    $('alexa-codigo').textContent = code.replace(/(\d{3})(\d{3})/, '$1 $2');
    $('alexa-steps').hidden = false; paintAlexa();
    alexaStatus('Aguardando você falar o código para a Alexa…');
    for (let i = 0; i < 200; i++) {                // confere a cada 3 s por até 10 min
      await new Promise((r) => setTimeout(r, 3000));
      if (await c.pairStatus()) { alexaStatus('Alexa conectada ✓. O que você pedir por voz entra na lista.', false); $('alexa-steps').hidden = true; iniciarSincronizacao(); return; }
      if (!$('alexa').open) break;
    }
  } catch (e) { alexaStatus(`Não consegui gerar o código: ${e.message}`, true); }
}
$('alexa-code').addEventListener('click', gerarCodigo);
$('alexa-off').addEventListener('click', () => { try { localStorage.removeItem(tokenKey()); } catch { /* sem armazenamento */ } state.syncCli = null; clearInterval(state.syncTimer); paintAlexa(); $('alexa-steps').hidden = true; alexaStatus('Desconectado neste aparelho (a lista continua aqui).'); });

// ---------- entrada (usuário e senha no navegador; veja lib/auth.js para o que isso é e o que não é)
const SESSAO = 'sms-sessao';
let usuarios = [];
let controle = { erros: 0, ate: 0 };

function sessaoSalva() {
  for (const s of [sessionStorage, localStorage]) { try { const v = JSON.parse(s.getItem(SESSAO) || 'null'); if (v && typeof v.user === 'string') return v; } catch { /* sem sessão */ } }
  return null;
}
function guardarSessao(u, manter) { try { (manter ? localStorage : sessionStorage).setItem(SESSAO, JSON.stringify(u)); } catch { /* sem armazenamento */ } }
function limparSessao() { for (const s of [sessionStorage, localStorage]) { try { s.removeItem(SESSAO); } catch { /* sem armazenamento */ } } }

function iniciar(u) {
  state.user = u.user;
  $('login').hidden = true; $('app').hidden = false;
  $('who').hidden = false; $('who-name').textContent = `Olá, ${u.name}`;
  restore();
  renderAll();
  showView(location.hash.slice(1) || 'lista', false);
  loadPrices();   // os preços carregam já; a API e os encartes vêm em paralelo, sem segurar a tela
  loadEncartes();
  probeApi();
  fetch('data/config.json', { cache: 'no-store' }).then((r) => r.json()).then((cfg) => { state.syncUrl = enderecoValido(cfg); iniciarSincronizacao(); }).catch(() => {});
}

function mostrarLogin(msg = '') {
  $('app').hidden = true; $('who').hidden = true; $('login').hidden = false;
  $('login-msg').textContent = msg;
  $('login-user').focus();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('login-msg'); const btn = $('login-btn');
  if (bloqueado(controle, Date.now())) { msg.textContent = `Muitas tentativas. Aguarde ${Math.ceil((controle.ate - Date.now()) / 1000)} s.`; return; }
  btn.disabled = true; msg.textContent = '';
  try {
    const u = await entrar(usuarios, $('login-user').value, $('login-pass').value);
    controle = tentativa(controle, !!u, Date.now());
    if (!u) { msg.textContent = 'Usuário ou senha incorretos.'; $('login-pass').value = ''; $('login-pass').focus(); return; }
    guardarSessao(u, $('login-keep').checked);
    $('login-pass').value = '';
    iniciar(u);
  } catch { msg.textContent = 'Não foi possível conferir a senha neste navegador.'; }
  finally { btn.disabled = false; }
});
$('logout').addEventListener('click', () => { limparSessao(); location.hash = ''; location.reload(); });

(async function arrancar() {
  try {
    const res = await fetch('data/users.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const lista = await res.json();
    if (!Array.isArray(lista) || !lista.length) throw new Error('sem usuários');
    usuarios = lista;
  } catch { mostrarLogin('Não consegui carregar os usuários. Recarregue a página.'); return; }
  const s = sessaoSalva();
  const u = s && usuarios.find((x) => x.user === s.user);
  if (u) iniciar({ user: u.user, name: u.name }); else { limparSessao(); mostrarLogin(); }
})();
