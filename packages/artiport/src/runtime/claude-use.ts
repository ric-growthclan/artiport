type DownloadData = string | Blob | ArrayBuffer | ArrayBufferView;

/**
 * The Claude Code artifact runtime (`window.claude.use`), reduced to what a single-owner hub can honour.
 * Every other capability resolves null, which the artifact contract already requires pages to handle.
 */
export function installClaude(): void {
  const host = window as unknown as { claude?: Record<string, unknown> };
  if (typeof host.claude?.use === 'function') return;

  const downloads = Object.freeze({
    async save(request: { filename: string; data: DownloadData }): Promise<{ status: 'saved' }> {
      if (!request || typeof request.filename !== 'string' || !request.filename || request.data == null) {
        throw { code: 'bad_request', message: 'save() needs a filename and data' };
      }
      const blob = request.data instanceof Blob ? request.data : new Blob([request.data as BlobPart]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = request.filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { status: 'saved' };
    },
  });

  const granted = { downloads: 'granted' } as const;
  const permissions = Object.freeze({
    async state(name?: string) {
      if (name === undefined) return { ...granted };
      return name === 'downloads' ? 'granted' : 'unavailable';
    },
    async request(names?: readonly string[]) {
      if (!names) return { ...granted };
      return Object.fromEntries(names.map((name) => [name, name === 'downloads' ? 'granted' : 'unavailable']));
    },
  });

  const user = Object.freeze({
    id: async () => 'owner',
    isOwner: async () => true,
    canEdit: async () => true,
  });

  const namespaces: Record<string, unknown> = { downloads, permissions, user };
  host.claude = { ...(host.claude ?? {}), use: async (name: string) => namespaces[name] ?? null };
}
