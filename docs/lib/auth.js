// Entrada por usuário e senha FEITA NO NAVEGADOR (o site é estático, sem servidor). Serve para separar a lista de cada pessoa e dar uma tela de entrada;
// NÃO é segurança forte: a página e o arquivo de usuários são públicos, e quem tiver o hash pode tentar adivinhar a senha offline (use senha longa).
// A senha nunca fica no código: só o hash PBKDF2-SHA256 com sal.

const enc = new TextEncoder();
export const ITERACOES = 210_000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Hash (base64) da senha com o sal (base64) e o número de iterações. */
export async function hashSenha(senha, saltB64, iteracoes = ITERACOES) {
  const chave = await crypto.subtle.importKey('raw', enc.encode(String(senha)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(saltB64), iterations: iteracoes }, chave, 256);
  return b64(bits);
}

/** Cria a entrada de um usuário: { user, name, salt, iterations, hash }. */
export async function criarUsuario(user, nome, senha, iteracoes = ITERACOES) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { user: String(user).trim().toLowerCase(), name: nome, salt, iterations: iteracoes, hash: await hashSenha(senha, salt, iteracoes) };
}

/** Comparação sem parar no primeiro caractere diferente. */
export function iguais(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Confere usuário (sem diferenciar maiúsculas) e senha; devolve o usuário (sem o hash) ou null. Usuário que não existe também gasta o cálculo (mesmo tempo). */
export async function entrar(usuarios, user, senha) {
  const u = (usuarios || []).find((x) => x.user === String(user).trim().toLowerCase());
  const alvo = u || { salt: usuarios?.[0]?.salt || b64(new Uint8Array(16)), iterations: usuarios?.[0]?.iterations || ITERACOES, hash: '' };
  const h = await hashSenha(senha, alvo.salt, alvo.iterations);
  return u && iguais(h, u.hash) ? { user: u.user, name: u.name } : null;
}

/** Bloqueio de tentativas: depois de 5 erros seguidos, espera 30 s. `agora` em ms. Estado puro, guardado pelo chamador. */
export function tentativa(estado, acertou, agora) {
  if (acertou) return { erros: 0, ate: 0 };
  const erros = (estado.erros || 0) + 1;
  return { erros, ate: erros >= 5 ? agora + 30_000 : 0 };
}
export const bloqueado = (estado, agora) => (estado.ate || 0) > agora;
