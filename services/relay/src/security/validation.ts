export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function isSessionTokenAccepted(token: string, minLength: number): boolean {
  return token.trim().length >= minLength;
}
