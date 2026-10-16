import { SignJWT, jwtVerify } from 'jose';

export interface SessionClaims {
  /** guest user id (stable across rooms when the client presents its previous token) */
  uid: string;
  /** room code the token grants access to */
  code: string;
  name: string;
  seed: string;
}

const ISSUER = 'blockparty';
const TTL = '24h';

export class TokenService {
  private key: Uint8Array;
  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: SessionClaims): Promise<string> {
    return new SignJWT({ code: claims.code, name: claims.name, seed: claims.seed })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.uid)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(TTL)
      .sign(this.key);
  }

  /** Returns the claims, or null when the token is invalid/expired. */
  async verify(token: string | undefined | null): Promise<SessionClaims | null> {
    if (!token || token.length > 2048) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      const { sub, code, name, seed } = payload as { sub?: unknown; code?: unknown; name?: unknown; seed?: unknown };
      if (typeof sub !== 'string' || typeof code !== 'string' || typeof name !== 'string' || typeof seed !== 'string')
        return null;
      return { uid: sub, code, name, seed };
    } catch {
      return null;
    }
  }
}
