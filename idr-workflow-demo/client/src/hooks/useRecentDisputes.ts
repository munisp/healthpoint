/**
 * useRecentDisputes
 * Tracks the last 5 dispute IDs visited by the user in localStorage.
 * Provides helpers to record a visit and retrieve the ordered list.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "recent-disputes";
const MAX_RECENT = 5;

export type RecentDispute = {
  id: string;
  referenceNumber: string;
  status: string;
  currentStep: string;
  serviceType: string;
  visitedAt: number; // epoch ms
};

function readStored(): RecentDispute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentDispute[];
  } catch {
    return [];
  }
}

function writeStored(items: RecentDispute[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function useRecentDisputes() {
  const [recent, setRecent] = useState<RecentDispute[]>(readStored);

  // Sync across tabs
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setRecent(readStored());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const recordVisit = useCallback((dispute: Omit<RecentDispute, "visitedAt">) => {
    setRecent((prev) => {
      const filtered = prev.filter((d) => d.id !== dispute.id);
      const next = [{ ...dispute, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      writeStored(next);
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    writeStored([]);
    setRecent([]);
  }, []);

  return { recent, recordVisit, clearRecent };
}
