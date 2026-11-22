/**
 * knownAttestations.ts — Phase16-FE
 *
 * The submitter router intentionally exposes no attestation LIST procedure
 * (issue/verify/revoke only). issueAttestation returns the attestation id +
 * artifact hash once. To keep delegation status honest without inventing a
 * server endpoint, the console remembers ids it has seen (issued or
 * verified) in localStorage, keyed by submitter-client link, and re-verifies
 * each through `submitter.verifyAttestation` (artifact + chain + validity
 * window) to derive active/expiring/revoked display state.
 */

const KEY = "submitter.knownAttestations.v1";

type Store = Record<string, string[]>;

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // storage full/unavailable — non-fatal; ids simply are not remembered
  }
}

export function rememberAttestation(submitterClientId: string, attestationId: string) {
  const store = read();
  const list = store[submitterClientId] ?? [];
  if (!list.includes(attestationId)) {
    store[submitterClientId] = [...list, attestationId];
    write(store);
  }
}

export function knownAttestationIds(submitterClientId: string): string[] {
  return read()[submitterClientId] ?? [];
}

export function forgetAttestation(submitterClientId: string, attestationId: string) {
  const store = read();
  store[submitterClientId] = (store[submitterClientId] ?? []).filter(id => id !== attestationId);
  write(store);
}
