// Importação no navegador (nada vai para servidor): TXT, CSV, planilha, PDF e foto. As bibliotecas pesadas só carregam quando o tipo de arquivo é usado.
import { parseText, parseRows } from './parse-list.js';

const LIBS = {
  xlsx: { url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', global: 'XLSX' },
  tesseract: { url: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js', global: 'Tesseract' },
};
const PDFJS = { module: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs', worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs' };

const loading = {};
function loadScript(key) {
  const lib = LIBS[key];
  if (window[lib.global]) return Promise.resolve(window[lib.global]);
  loading[key] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = lib.url; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window[lib.global]);
    s.onerror = () => { delete loading[key]; reject(new Error('Não foi possível carregar a biblioteca de leitura (verifique a internet).')); };
    document.head.append(s);
  });
  return loading[key];
}

/** CSV simples com aspas e separador , ; ou tab (detectado). */
export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const sep = [';', '\t', ','].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function readPdf(file, progress) {
  progress('Lendo o PDF…');
  const pdfjs = await import(/* @vite-ignore */ PDFJS.module);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS.worker;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const byY = new Map();
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3);
      byY.set(y, [...(byY.get(y) || []), { x: it.transform[4], s: it.str }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) lines.push(byY.get(y).sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
  }
  return lines.join('\n');
}

async function readImage(file, progress) {
  progress('Carregando o leitor de fotos (primeira vez demora um pouco)…');
  const T = await loadScript('tesseract');
  const worker = await T.createWorker('por', 1, { logger: (m) => { if (m.status === 'recognizing text') progress(`Lendo a foto… ${Math.round(m.progress * 100)}%`); } });
  try { const { data } = await worker.recognize(file); return data.text || ''; } finally { await worker.terminate(); }
}

async function readSheet(file, progress) {
  progress('Lendo a planilha…');
  const X = await loadScript('xlsx');
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return X.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
}

/** Arquivo -> itens { name, qty }. `progress(texto)` mostra o andamento. Lança Error com mensagem em português. */
export async function importFile(file, progress = () => {}) {
  const name = file.name.toLowerCase();
  const type = file.type || '';
  if (/\.(xlsx|xls|xlsm|ods)$/.test(name)) return parseRows(await readSheet(file, progress));
  if (/\.csv$/.test(name) || type === 'text/csv') return parseRows(parseCsv(await file.text()));
  if (/\.pdf$/.test(name) || type === 'application/pdf') return parseText(await readPdf(file, progress));
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|heic)$/.test(name)) return parseText(await readImage(file, progress));
  if (/\.(txt|text|md|list)$/.test(name) || type.startsWith('text/')) return parseText(await file.text());
  throw new Error('Tipo de arquivo não suportado. Use TXT, CSV, planilha (XLSX), PDF ou uma foto.');
}
