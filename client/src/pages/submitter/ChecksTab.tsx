/**
 * ChecksTab — Phase 20-FE. Manual check-payment bookkeeping for submitters,
 * wired to server/routers/submitter.ts Phase 20-A procedures:
 *
 *   submitter.postCheckPayment        — record an incoming paper check
 *     (bookkeeping ONLY: no payment is initiated, no ledger entry is
 *     written; server comment, Phase 20-A).
 *   submitter.listCheckPostings       — status lifecycle posted → matched →
 *     deposited (→ reconciled is a later back-office step; no public
 *     procedure transitions to it).
 *   submitter.matchCheckToRemittances — HUMAN confirm of a proposal:
 *     proposals are computed server-side at postCheckPayment / ingest835
 *     time and NEVER persisted or auto-applied (server/remittance/
 *     check-match.ts). Signals shown verbatim: exactTraceMatch, amount
 *     discrepancy, score, reasons.
 *   submitter.markCheckDeposited      — record the bank deposit date.
 *
 * Proposals are ephemeral by design; this tab mirrors the ones it observed
 * (posting/ingest time) into localStorage per org so they survive a
 * refresh, and says so honestly.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type CheckPosting = {
  id: string;
  checkNumber: string;
  amountCents: number;
  payerName: string;
  receivedDate: string;
  status: string;
  depositDate: string | null;
  matchedPaymentTraceNumber: string | null;
  notes: string | null;
};

export type CheckMatchProposal = {
  checkPostingId: string;
  fileId: string;
  score: number;
  exactTraceMatch: boolean;
  amountDiscrepancyCents: number;
  reasons: string[];
};

type RemittanceLine = { id: string; claimId: string; allowedCents: number | null; payerId: string | null };

const usd = (cents: number | null | undefined) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`);

const PROPOSALS_KEY_PREFIX = "check-match-proposals:";
const proposalsKey = (orgId: string) => `${PROPOSALS_KEY_PREFIX}${orgId}`;

/** Mirror proposals observed at posting/ingest time (they are not persisted server-side). */
export function stashProposals(orgId: string, proposals: CheckMatchProposal[]): void {
  if (!proposals.length) return;
  try {
    const raw = window.localStorage.getItem(proposalsKey(orgId));
    const map: Record<string, CheckMatchProposal[]> = raw ? JSON.parse(raw) : {};
    for (const p of proposals) {
      const list = (map[p.checkPostingId] ?? []).filter(x => x.fileId !== p.fileId);
      list.push(p);
      list.sort((a, b) => b.score - a.score);
      map[p.checkPostingId] = list;
    }
    window.localStorage.setItem(proposalsKey(orgId), JSON.stringify(map));
  } catch {
    /* storage full/blocked — proposals are advisory only */
  }
}

function loadProposals(orgId: string): Record<string, CheckMatchProposal[]> {
  try {
    const raw = window.localStorage.getItem(proposalsKey(orgId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Line-picker + human confirm for one proposal. */
function MatchConfirm({ posting, proposal, onDone }: { posting: CheckPosting; proposal: CheckMatchProposal; onDone: () => void }) {
  const linesQ = trpc.submitter.listRemittanceLines.useQuery({ fileId: proposal.fileId });
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const lines = (linesQ.data ?? []) as RemittanceLine[];
  // Default: all lines of the proposed file selected.
  const effectivePicked = picked ?? new Set(lines.map(l => l.id));
  const match = trpc.submitter.matchCheckToRemittances.useMutation({
    onSuccess: r => {
      const disc = r.discrepancyCents;
      toast.success(
        disc === 0
          ? "Check matched to remittance lines — amounts agree exactly"
          : `Check matched; discrepancy of ${usd(Math.abs(disc))} recorded (non-blocking, human-reconciled)`,
      );
      onDone();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30">
      <p className="text-sm font-medium">
        Confirm match: check #{posting.checkNumber} ({usd(posting.amountCents)}) ↔ 835 file{" "}
        <code className="text-xs break-all">{proposal.fileId}</code>
      </p>
      {proposal.exactTraceMatch && (
        <Badge variant="default">exactTraceMatch — the 835 trace number equals this check number</Badge>
      )}
      <ul className="text-xs text-muted-foreground list-disc pl-4">
        {proposal.reasons.map((r, i) => <li key={i}>{r}</li>)}
        {proposal.amountDiscrepancyCents > 0 && (
          <li>Amount differs by {usd(proposal.amountDiscrepancyCents)} (recorded, non-blocking)</li>
        )}
      </ul>
      {linesQ.isLoading && <p className="text-sm text-muted-foreground">Loading remittance lines…</p>}
      {linesQ.isError && <p role="alert" className="text-sm text-destructive">{linesQ.error.message}</p>}
      {lines.length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {lines.map(l => (
            <label key={l.id} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={effectivePicked.has(l.id)}
                onCheckedChange={() => {
                  const next = new Set(effectivePicked);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  setPicked(next);
                }}
              />
              <span className="font-mono">{l.claimId}</span>
              <span>{usd(l.allowedCents)}</span>
              <span className="text-muted-foreground">{l.payerId ?? ""}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={match.isPending || effectivePicked.size === 0 || lines.length === 0}
          onClick={() => match.mutate({
            checkPostingId: posting.id,
            remittanceLineIds: [...effectivePicked],
          })}
        >
          {match.isPending ? "Matching…" : `Confirm match (${effectivePicked.size} line${effectivePicked.size === 1 ? "" : "s"})`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

export default function ChecksTab({ orgId }: { orgId: string }) {
  const [checkNumber, setCheckNumber] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [payerName, setPayerName] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [proposals, setProposals] = useState<Record<string, CheckMatchProposal[]>>({});
  const [confirming, setConfirming] = useState<{ posting: CheckPosting; proposal: CheckMatchProposal } | null>(null);
  const [depositFor, setDepositFor] = useState<string | null>(null);
  const [depositDate, setDepositDate] = useState("");

  useEffect(() => {
    setProposals(loadProposals(orgId));
    setConfirming(null);
  }, [orgId]);

  const postingsQ = trpc.submitter.listCheckPostings.useQuery({ orgId, limit: 100 });
  const postings = (postingsQ.data ?? []) as CheckPosting[];

  const post = trpc.submitter.postCheckPayment.useMutation({
    onSuccess: r => {
      toast.success(`Check #${checkNumber} recorded as posted`);
      if (r.matchProposals?.length) {
        stashProposals(orgId, r.matchProposals as CheckMatchProposal[]);
        setProposals(loadProposals(orgId));
        toast.info(`${r.matchProposals.length} match proposal${r.matchProposals.length === 1 ? "" : "s"} found — review below`);
      }
      setCheckNumber(""); setAmountUsd(""); setPayerName(""); setReceivedDate(""); setNotes("");
      postingsQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const deposit = trpc.submitter.markCheckDeposited.useMutation({
    onSuccess: () => {
      toast.success("Marked as deposited");
      setDepositFor(null);
      setDepositDate("");
      postingsQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const postValid =
    checkNumber.trim().length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(amountUsd) && Number(amountUsd) > 0 &&
    payerName.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(receivedDate);

  const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
    posted: "secondary",
    matched: "default",
    deposited: "outline",
    reconciled: "outline",
  };

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Record a check payment</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">
            This records that a payer's paper check arrived — bookkeeping only. No payment is initiated and no
            money moves through the platform. When the matching 835 remittance has been ingested, the server
            proposes matches (trace number, amount, payer, date); a person always confirms — nothing is
            auto-matched.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div><Label className="text-xs">Check number</Label><Input value={checkNumber} onChange={e => setCheckNumber(e.target.value)} aria-label="Check number" /></div>
            <div><Label className="text-xs">Amount (USD)</Label><Input inputMode="decimal" placeholder="15234.00" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} aria-label="Check amount USD" /></div>
            <div><Label className="text-xs">Payer</Label><Input value={payerName} onChange={e => setPayerName(e.target.value)} aria-label="Payer name" /></div>
            <div><Label className="text-xs">Date received</Label><Input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} aria-label="Date received" /></div>
          </div>
          <div><Label className="text-xs">Notes (optional)</Label><Input value={notes} onChange={e => setNotes(e.target.value)} aria-label="Notes" /></div>
          <Button size="sm" disabled={post.isPending || !postValid}
            onClick={() => post.mutate({ orgId, checkNumber: checkNumber.trim(), amountUsd, payerName: payerName.trim(), receivedDate, notes: notes.trim() || undefined })}>
            {post.isPending ? "Recording…" : "Record check"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Check postings</span>
            <Button size="sm" variant="ghost" onClick={() => postingsQ.refetch()} disabled={postingsQ.isFetching}>
              {postingsQ.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {postingsQ.isLoading && <p className="text-sm text-muted-foreground">Loading check postings…</p>}
          {postingsQ.isError && <p role="alert" className="text-sm text-destructive">{postingsQ.error.message}</p>}
          {postingsQ.data && postings.length === 0 && (
            <p className="text-sm text-muted-foreground">No check payments recorded for this organization yet.</p>
          )}
          {postings.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check #</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Payer</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {postings.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.checkNumber}</TableCell>
                    <TableCell>{usd(p.amountCents)}</TableCell>
                    <TableCell>{p.payerName}</TableCell>
                    <TableCell className="text-xs">{p.receivedDate}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>{p.status}</Badge>
                      {p.depositDate && <p className="text-xs text-muted-foreground mt-0.5">deposited {p.depositDate}</p>}
                      {p.matchedPaymentTraceNumber && <p className="text-xs text-muted-foreground mt-0.5">trace {p.matchedPaymentTraceNumber}</p>}
                    </TableCell>
                    <TableCell className="space-x-2">
                      {p.status === "posted" && (
                        <Button size="sm" variant="outline" onClick={() => {
                          const ps = proposals[p.id] ?? [];
                          if (!ps.length) {
                            toast.info("No stored proposals for this check. Proposals are computed when a check is recorded or a matching 835 is ingested — they are advisory and not kept server-side.");
                            return;
                          }
                          setConfirming({ posting: p, proposal: ps[0] });
                        }}>
                          Match to remittances{(proposals[p.id]?.length ?? 0) > 0 ? ` (${proposals[p.id].length})` : ""}
                        </Button>
                      )}
                      {(p.status === "posted" || p.status === "matched") && (
                        <Button size="sm" variant="outline" onClick={() => { setDepositFor(depositFor === p.id ? null : p.id); setDepositDate(""); }}>
                          Mark deposited
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {depositFor && (
            <div className="border rounded-md p-3 flex flex-wrap items-end gap-2 bg-muted/30">
              <div>
                <Label className="text-xs">Deposit date</Label>
                <Input type="date" value={depositDate} onChange={e => setDepositDate(e.target.value)} aria-label="Deposit date" />
              </div>
              <Button size="sm" disabled={deposit.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(depositDate)}
                onClick={() => deposit.mutate({ checkPostingId: depositFor, depositDate })}>
                {deposit.isPending ? "Saving…" : "Confirm deposit"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDepositFor(null)}>Cancel</Button>
            </div>
          )}

          {confirming && (
            <div className="space-y-2">
              {(proposals[confirming.posting.id] ?? []).map(pr => (
                <div key={pr.fileId} className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Proposal score {pr.score}</span>
                    {pr.exactTraceMatch && <Badge variant="default">exactTraceMatch</Badge>}
                    {pr.fileId !== confirming.proposal.fileId && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirming({ posting: confirming.posting, proposal: pr })}>
                        Review this one
                      </Button>
                    )}
                  </div>
                  {pr.fileId === confirming.proposal.fileId && (
                    <MatchConfirm posting={confirming.posting} proposal={pr} onDone={() => { setConfirming(null); postingsQ.refetch(); }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
