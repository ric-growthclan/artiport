export interface StoredFile {
  /** Git blob id of the content. */
  oid: string;
  text: string;
}

export type CommitResult = { ok: true; head: string } | { ok: false };

/** Where data files live. Every read reports the head commit it saw; commits only land on that same head. */
export interface DataStore {
  list(prefixes: string[]): Promise<{ head: string | null; files: Record<string, string> }>;
  read(paths: string[]): Promise<{ head: string | null; files: Record<string, StoredFile | null> }>;
  commit(expectedHead: string | null, files: Record<string, string>, message: string): Promise<CommitResult>;
}
