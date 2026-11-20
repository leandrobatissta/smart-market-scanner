import { importFile } from './lib/import.js';
import { applyImport, mergeDuplicates, parseLine, parseText } from './lib/parse-list.js';
import { prepare } from './lib/match.js';
import { compute } from './lib/basket.js';

const $ = (id) => document.getElementById(id);
const KEY = 'sms-list-v1';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const state = { list: [], products: [], stores: [], storeNames: {}, pending: null };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- persistência (só no navegador; se o armazenamento falhar, a lista vive só na página)
function save() { try { localStorage.setItem(KEY, JSON.stringify(state.list)); } catch { /* sem armazenamento */ } }
function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(raw)) state.list = raw.filter((i) => i && typeof i.name === 'string' && i.qty > 0).map((i) => ({ name: i.name.slice(0, 80), qty: Math.min(Number(i.qty) || 1, 999) }));
  } catch { state.list = []; }
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
    li.append(qty, el('span', 'nm', it.name), x);
    ul.append(li);
  });
  $('list-empty').hidden = state.list.length > 0;
  $('clear').hidden = state.list.length === 0;
}

function addManual(e) {
  e.preventDefault();
  const name = $('add-name').value.trim();
  const qty = Math.max(1, Math.round(Number($('add-qty').value) || 1));
  const it = parseLine(`${name}`);
  if (!it) return;
  state.list = mergeDuplicates([...state.list, { name: it.name, qty: qty * (it.qty || 1) }]);
  $('add-name').value = ''; $('add-qty').value = '1';
  save(); renderAll(); $('add-name').focus();
}

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
  const box = $('result');
  const stores = state.stores;
  if (!state.list.length || !stores.length) { box.hidden = true; return; }
  box.hidden = false;
  const out = compute(state.list, state.products, stores);
  const cheapest = Object.entries(out.totals).filter(([, t]) => t.found === state.list.length).sort((a, b) => a[1].total - b[1].total)[0];

  const tot = $('totals'); tot.replaceChildren();
  for (const s of stores) {
    const t = out.totals[s];
    const c = el('div', 'tot' + (cheapest && cheapest[0] === s ? ' best' : ''));
    c.append(el('span', 'tot__n', state.storeNames[s] || s), el('span', 'tot__v', brl.format(t.total)),
      el('span', 'tot__s', t.missing ? `${t.found} de ${state.list.length} itens (faltam ${t.missing})` : 'todos os itens'));
    tot.append(c);
  }
  if (stores.length > 1) {
    const c = el('div', 'tot');
    c.append(el('span', 'tot__n', 'Mais barato misturando mercados'), el('span', 'tot__v', brl.format(out.mix.total)),
      el('span', 'tot__s', 'exige comprar em mais de um lugar'));
    tot.append(c);
  }

  const head = $('thead'); head.replaceChildren();
  const hr = el('tr'); hr.append(el('th', '', 'Item'));
  for (const s of stores) hr.append(el('th', '', state.storeNames[s] || s));
  head.append(hr);
  const body = $('tbody'); body.replaceChildren();
  const missing = [];
  for (const r of out.rows) {
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
        td.append(document.createTextNode(brl.format(p.price * r.item.qty)));
        const pn = el('span', 'pn');
        const a = el('a', '', p.name); a.href = /^https:\/\//.test(p.url) ? p.url : '#'; a.target = '_blank'; a.rel = 'noopener noreferrer';
        pn.append(a);
        pn.append(document.createTextNode(` · ${brl.format(p.price)}${p.unitPrice && p.size ? ` (${brl.format(p.unitPrice)}/${p.size.unit})` : ''}${p.listPrice > p.price ? ' · em oferta' : ''}`));
        td.append(pn);
      }
      tr.append(td);
    }
    if (!any) missing.push(r.item.name);
    body.append(tr);
  }
  const nf = $('notfound');
  nf.hidden = missing.length === 0;
  if (missing.length) nf.textContent = `Sem preço em nenhum mercado (ainda não está no catálogo coletado): ${missing.join(', ')}.`;
}

function renderStores(data) {
  const ul = $('storelist'); ul.replaceChildren();
  for (const s of data.stores) {
    const li = el('li');
    const label = s.status === 'ok' ? `${s.name}: ${s.products} produtos coletados` : `${s.name}: indisponível (${s.reason || s.status})`;
    li.textContent = label + (s.reason && s.status === 'ok' ? ` · ${s.reason}` : '');
    ul.append(li);
  }
  $('stores').hidden = false;
}

function renderAll() { renderList(); renderResult(); }

async function loadPrices() {
  try {
    const res = await fetch('data/prices.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.products) || !Array.isArray(data.stores)) throw new Error('arquivo de dados inválido');
    state.products = data.products.map(prepare);
    const ok = data.stores.filter((s) => s.status === 'ok');
    state.stores = ok.map((s) => s.id);
    state.storeNames = Object.fromEntries(data.stores.map((s) => [s.id, s.name]));
    const when = new Date(data.generatedAt);
    const hours = Math.round((Date.now() - when.getTime()) / 36e5);
    $('meta').textContent = `Preços coletados em ${when.toLocaleString('pt-BR')} (há ${hours < 1 ? 'menos de 1 h' : hours + ' h'}) · ${data.region} · ${state.products.length} produtos`;
    renderStores(data);
    renderResult();
  } catch (e) {
    $('meta').textContent = '';
    const err = $('error'); err.hidden = false;
    err.textContent = `Não foi possível carregar os preços (${e.message}). Rodando localmente? Execute "make scan" para gerar o arquivo de preços.`;
  }
}

$('add').addEventListener('submit', addManual);
$('file').addEventListener('change', (e) => onFile(e.target));
$('photo').addEventListener('change', (e) => onFile(e.target));
$('read-paste').addEventListener('click', () => { const items = parseText($('paste').value); showPreview(items); });
$('apply').addEventListener('click', applyPending);
$('cancel').addEventListener('click', () => { state.pending = null; $('preview').hidden = true; status(''); });
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => { if (!$('preview').hidden) $('apply').textContent = mode() === 'replace' ? 'Substituir a lista' : 'Adicionar à lista'; });
$('clear').addEventListener('click', () => { state.list = []; save(); renderAll(); });

restore();
renderAll();
loadPrices();
