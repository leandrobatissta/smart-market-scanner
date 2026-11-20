// Gera a linha de um usuário para docs/data/users.json (a senha NÃO fica no repositório, só o hash).
// Uso: node tools/hash-password.mjs <usuario> "<Nome>" "<senha>"
import { criarUsuario } from '../docs/lib/auth.js';
const [user, nome, senha] = process.argv.slice(2);
if (!user || !nome || !senha) { console.error('uso: node tools/hash-password.mjs <usuario> "<Nome>" "<senha>"'); process.exit(2); }
console.log(JSON.stringify(await criarUsuario(user, nome, senha)));
