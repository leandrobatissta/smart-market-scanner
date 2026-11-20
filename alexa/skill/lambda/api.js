// Cliente do Worker (a skill nunca guarda a lista: só pede ao Worker, com o segredo compartilhado).
export function criarApi({ url, segredo, fetchFn = fetch }) {
  const base = String(url).replace(/\/$/, '');
  async function chamar(caminho, userId, extra = {}) {
    const res = await fetchFn(`${base}${caminho}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skill-secret': segredo }, body: JSON.stringify({ alexaUserId: userId, ...extra }) });
    let corpo = {};
    try { corpo = await res.json(); } catch { /* sem corpo */ }
    if (!res.ok) { const e = new Error(corpo.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
    return corpo;
  }
  return {
    list: (u) => chamar('/alexa/list', u),
    add: (u, name, qty) => chamar('/alexa/add', u, { name, qty }),
    remove: (u, name) => chamar('/alexa/remove', u, { name }),
    clear: (u) => chamar('/alexa/clear', u),
    link: (u, code) => chamar('/alexa/link', u, { code }),
  };
}
