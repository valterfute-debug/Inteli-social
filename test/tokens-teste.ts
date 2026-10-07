import { JWTVerifyGetKey, SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

/** Mesmo valor definido em test/ambiente.cjs: o emissor esperado é `${SUPABASE_URL}/auth/v1`. */
export const SUPABASE_URL_TESTE = 'https://projeto-teste.supabase.invalid';

export interface OpcoesToken {
  sub?: string;
  email?: string;
  emissor?: string;
  audiencia?: string;
  /** Ex.: '1h', ou um instante (segundos) no passado para gerar token vencido. */
  expiraEm?: string | number;
}

/**
 * Simula o Supabase Auth: gera um par de chaves ES256, expõe a chave pública como JWKS
 * e assina tokens no mesmo formato dos tokens reais.
 */
export async function criarEmissorDeTokens(kid = 'chave-teste') {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const chaves: JWTVerifyGetKey = createLocalJWKSet({ keys: [jwk] });

  const assinar = (opcoes: OpcoesToken = {}) =>
    new SignJWT({
      email: opcoes.email ?? 'voluntario@teste.invalid',
      role: 'authenticated',
    })
      .setProtectedHeader({ alg: 'ES256', kid })
      .setSubject(opcoes.sub ?? '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5')
      .setIssuer(opcoes.emissor ?? `${SUPABASE_URL_TESTE}/auth/v1`)
      .setAudience(opcoes.audiencia ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(opcoes.expiraEm ?? '1h')
      .sign(privateKey);

  return { chaves, assinar };
}
