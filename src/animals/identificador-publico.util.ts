import { randomBytes } from 'node:crypto';

export function gerarIdentificadorPublico(): string {
  const ano = new Date().getUTCFullYear();
  const sufixo = randomBytes(4).toString('hex').toUpperCase();
  return `AM-${ano}-${sufixo}`;
}
