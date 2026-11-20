// Cliente do Worker da lista (sincroniza com a Alexa). O token é gerado AQUI, no navegador, e só o hash dele vive no servidor.

/** Token aleatório de 43 caracteres (256 bits em base64url). */
export function novoToken(cripto = globalThis.crypto) {
  const b = cripto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function criarCliente({ url, token, fetchFn = (...a) => fetch(...a) }) {
  const base = String(url).replace(/\/$/, '');
  async function chamar(metodo, caminho, corpo) {
    const res = await fetchFn(base + caminho, { method: metodo, headers: { authorization: `Bearer ${token}`, ...(corpo ? { 'content-type': 'application/json' } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined, cache: 'no-store' });
    let json = {};
    try { json = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) { const e = new Error(json.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return json;
  }
  return {
    pull: async () => (await chamar('GET', '/list')).items || [],
    push: async (itens) => (await chamar('PUT', '/list', { items: itens })).items || [],
    pairStart: () => chamar('POST', '/pair/start'),
    pairStatus: async () => (await chamar('GET', '/pair/status')).linked === true,
  };
}

/** Endereço do Worker a partir de data/config.json: só https (ou localhost, para teste); senão a sincronização fica desligada. */
export function enderecoValido(cfg) {
  const u = cfg && typeof cfg.syncUrl === 'string' ? cfg.syncUrl.trim() : '';
  return /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(u) ? u : '';
}
