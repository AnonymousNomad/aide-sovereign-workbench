export interface AuthorityPeer {
  connected?: boolean;
  send(message: unknown, callback: (error: Error | null) => void): boolean;
  on(event: string, callback: (...args: any[]) => void): unknown;
  once(event: string, callback: (...args: any[]) => void): unknown;
  off(event: string, callback: (...args: any[]) => void): unknown;
}
export interface AuthorityChannel {
  call(method: string, payload: unknown, timeoutMs?: number): Promise<unknown>;
  close(): void;
}
export function connectAuthorityChannel(peer: AuthorityPeer, handle?: (method: string, payload: any) => Promise<unknown>): AuthorityChannel;
export function superviseAuthority(archChild: AuthorityPeer): {
  attach(role: 'facade' | 'legacy', child: AuthorityPeer): void;
  pairing(origin: string): Promise<unknown>;
  authenticate(token: string, origin: string): Promise<unknown>;
  ready(): Promise<unknown>;
  close(): void;
};
