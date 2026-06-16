import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET!;
const EXPIRES = process.env.JWT_EXPIRES_IN || '30d';

export interface TokenPayload {
  ownerId: string;
  restaurantId: string;
  slug: string;
  role: 'owner';
}

export interface TenantTokenPayload {
  restaurantId: string;
  slug: string;
  role: 'admin' | 'cashier' | 'captain';
  stationId?: string;
  menuFilter?: string;
  captainId?: string;
  menuUploaded: boolean;
  allowedSections?: string;
  handleOnlineOrders?: boolean;
}

export function signOwnerToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES } as jwt.SignOptions);
}

export function signTenantToken(payload: TenantTokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '12h' } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload | TenantTokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload | TenantTokenPayload;
}
