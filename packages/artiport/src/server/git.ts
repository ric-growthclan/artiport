const encoder = new TextEncoder();

/** The id git gives a blob with this content, so locally written files can be compared with the repo. */
export async function gitBlobOid(text: string): Promise<string> {
  const body = encoder.encode(text);
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8ToBase64(text: string): string {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
