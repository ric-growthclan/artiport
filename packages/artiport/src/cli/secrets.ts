import { randomBytes, randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Five groups of four unambiguous characters: about 99 bits, and easy to type on a phone. */
export function generatePassphrase(groups = 5, length = 4): string {
  return Array.from({ length: groups }, () =>
    Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''),
  ).join('-');
}

export function generateSecrets(): { HUB_PASSPHRASE: string; HUB_SESSION_SECRET: string; HUB_SESSION_VERSION: string } {
  return {
    HUB_PASSPHRASE: generatePassphrase(),
    HUB_SESSION_SECRET: randomBytes(32).toString('base64url'),
    HUB_SESSION_VERSION: '1',
  };
}
