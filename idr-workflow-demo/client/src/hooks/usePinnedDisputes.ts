import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "hp_pinned_disputes";
const MAX_PINS = 10;

export interface PinnedDispute {
  id: string;
  referenceNumber: string;
  serviceType: string;
  status: string;
  pinnedAt: number;
}

function readStorage(): PinnedDispute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PinnedDispute[];
  } catch {
    return [];
  }
}

function writeStorage(pins: PinnedDispute[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // quota exceeded — silently ignore
  }
}

export function usePinnedDisputes() {
  const [pins, setPins] = useState<PinnedDispute[]>(() => readStorage());

  // Keep in sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setPins(readStorage());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const isPinned = useCallback(
    (id: string) => pins.some((p) => p.id === id),
    [pins]
  );

  const pin = useCallback((dispute: Omit<PinnedDispute, "pinnedAt">) => {
    setPins((prev) => {
      if (prev.some((p) => p.id === dispute.id)) return prev;
      const next = [{ ...dispute, pinnedAt: Date.now() }, ...prev].slice(
        0,
        MAX_PINS
      );
      writeStorage(next);
      return next;
    });
  }, []);

  const unpin = useCallback((id: string) => {
    setPins((prev) => {
      const next = prev.filter((p) => p.id !== id);
      writeStorage(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (dispute: Omit<PinnedDispute, "pinnedAt">) => {
      if (isPinned(dispute.id)) {
        unpin(dispute.id);
      } else {
        pin(dispute);
      }
    },
    [isPinned, pin, unpin]
  );

  return { pins, isPinned, pin, unpin, toggle };
}
