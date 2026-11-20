// Compartilhar a lista consolidada: texto (WhatsApp, e-mail, copiar), planilha CSV e dados para a imagem. Funções puras, sem DOM.

const fmt = (brl, v) => brl.format(v);

/** Linhas por mercado e categoria: [{ store, total, groups: [{ category, entries: [{ qty, name, product, sub }] }] }]. */
export function groupOption(option, storeNames) {
  return option.stores.map((s) => {
    const entries = [...option.assign[s]].sort((a, b) => a.category.localeCompare(b.category, 'pt-BR') || a.item.name.localeCompare(b.item.name, 'pt-BR'));
    const groups = [];
    for (const e of entries) {
      let g = groups[groups.length - 1];
      if (!g || g.category !== e.category) { g = { category: e.category, entries: [] }; groups.push(g); }
      g.entries.push({ qty: e.item.qty, name: e.product.name, want: e.item.name, price: e.product.price, sub: e.sub, url: e.product.url, extra: !!e.extra });
    }
    return { store: storeNames[s] || s, total: Math.round(entries.reduce((t, e) => t + e.sub, 0) * 100) / 100, groups };
  });
}

export function title(option) {
  return option.stores.length === 1 ? 'Compra em 1 mercado' : `Compra em ${option.stores.length} mercados`;
}

/** Texto da lista (serve para WhatsApp, e-mail e copiar). */
export function buildText(option, storeNames, brl, dateLabel) {
  const lines = [`Lista de compras · ${dateLabel}`, `${title(option)} · total ${fmt(brl, option.total)}${option.uncovered && option.uncovered.length ? ` (${option.covered} de ${option.universe} itens)` : ''}`, ''];
  for (const s of groupOption(option, storeNames)) {
    lines.push(`*${s.store}* — ${fmt(brl, s.total)}`);
    for (const g of s.groups) {
      lines.push(g.category);
      for (const e of g.entries) lines.push(`• ${e.qty}x ${e.name} — ${fmt(brl, e.sub)}`);
    }
    lines.push('');
  }
  if (option.uncovered && option.uncovered.length) lines.push(`Não encontrados ${option.stores.length === 1 ? 'neste mercado' : 'nestes mercados'}: ${option.uncovered.map((u) => u.item.name).join(', ')}.`, '');
  if (option.missing) lines.push(`Sem preço em nenhum mercado: ${option.missing} item(ns).`, '');
  lines.push('Preços da loja virtual de cada mercado; confira antes de comprar.');
  return lines.join('\n');
}

/** CSV (separador ;, UTF-8 com BOM para o Excel). Células que começam com = + - @ ganham aspas simples (evita fórmula injetada). */
export function buildCsv(option, storeNames) {
  const cell = (v) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [['Mercado', 'Categoria', 'Item', 'Produto', 'Qtd', 'Preço unitário', 'Subtotal']];
  for (const s of groupOption(option, storeNames)) {
    for (const g of s.groups) for (const e of g.entries) rows.push([s.store, g.category, e.want, e.name, e.qty, e.price.toFixed(2).replace('.', ','), e.sub.toFixed(2).replace('.', ',')]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

export const whatsappUrl = (text) => 'https://wa.me/?text=' + encodeURIComponent(text);

/** mailto: tem limite prático de tamanho; passando de `max` caracteres o corpo é cortado com um aviso (o texto completo vai por copiar/baixar). */
export function mailtoUrl(subject, body, max = 1800) {
  let b = body;
  if (encodeURIComponent(b).length > max) {
    const note = '\n\n[lista cortada: use "Copiar texto" ou "Baixar" para a lista completa]';
    while (encodeURIComponent(b + note).length > max && b.length > 0) b = b.slice(0, Math.floor(b.length * 0.9));
    b += note;
  }
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
}
