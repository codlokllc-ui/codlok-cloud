import type { CredentialRecord } from './types';

interface CredentialStore {
  records: Map<string, CredentialRecord>;
  byWorkspace: Map<string, Set<string>>;
}

const STORE_KEY = Symbol.for('codlok.product-credentials.store.v1');

function freshStore(): CredentialStore {
  return { records: new Map(), byWorkspace: new Map() };
}

function getStore(): CredentialStore {
  const root = globalThis as Record<symbol, unknown>;
  if (!root[STORE_KEY]) root[STORE_KEY] = freshStore();
  return root[STORE_KEY] as CredentialStore;
}

export const credentialStore = {
  insert(record: CredentialRecord): void {
    const store = getStore();
    store.records.set(record.credentialId, record);
    const ids = store.byWorkspace.get(record.workspaceId) ?? new Set<string>();
    ids.add(record.credentialId);
    store.byWorkspace.set(record.workspaceId, ids);
  },
  get(credentialId: string): CredentialRecord | undefined {
    return getStore().records.get(credentialId);
  },
  list(workspaceId: string): CredentialRecord[] {
    const store = getStore();
    return [...(store.byWorkspace.get(workspaceId) ?? [])]
      .map((id) => store.records.get(id))
      .filter((record): record is CredentialRecord => Boolean(record));
  },
};

export function _resetCredentialStoreForTesting(): void {
  (globalThis as Record<symbol, unknown>)[STORE_KEY] = freshStore();
}
