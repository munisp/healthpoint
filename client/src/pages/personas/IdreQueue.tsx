/**
 * /idre/queue — IDRE/arbitrator workbench (v1): assignment queue, COI
 * attestation dialog on accept, decline, and the determination writer with
 * the prohibited-basis screen enforced server-side.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function IdreQueue() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.idre.listQueue.useQuery();
  const [coi, setCoi] = useState<Record<string, { a: boolean; b: boolean; c: boolean }>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState<Record<string, string>>({});

  const invalidate = () => utils.idre.listQueue.invalidate();
  const accept = trpc.idre.acceptAssignment.useMutation({
    onSuccess: () => { toast.success("Assignment accepted"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const decline = trpc.idre.declineAssignment.useMutation({
    onSuccess: () => { toast.success("Assignment declined"); invalidate(); },
    onError: e => toast.error(e.message),
  });
  const writeDet = trpc.idre.writeDetermination.useMutation({
    onSuccess: () => { toast.success("Determination issued"); invalidate(); },
    onError: e => toast.error(e.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">IDRE Assignment Queue</h1>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && !data?.length && (
          <p className="text-sm text-muted-foreground">No assignments are addressed to you.</p>
        )}
        {data?.map(a => {
          const c = coi[a.assignmentId] ?? { a: false, b: false, c: false };
          const setC = (k: "a" | "b" | "c", v: boolean) => setCoi(s => ({ ...s, [a.assignmentId]: { ...c, [k]: v } }));
          return (
            <Card key={a.assignmentId}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {a.referenceNumber ?? a.disputeId}
                  <Badge variant="outline">{a.status}</Badge>
                  <Badge variant="secondary">{a.disputeStatus}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>Billed: <b>{a.billedAmount ? `$${a.billedAmount}` : "—"}</b></div>
                  <div>QPA: <b>{a.qpaAmount ? `$${a.qpaAmount}` : "—"}</b></div>
                  <div>Initiating offer: <b>{a.initiatingPartyOffer ? `$${a.initiatingPartyOffer}` : "—"}</b></div>
                  <div>Responding offer: <b>{a.respondingPartyOffer ? `$${a.respondingPartyOffer}` : "—"}</b></div>
                </div>

                {a.status === "proposed" && (
                  <div className="space-y-2 border rounded p-3">
                    <p className="font-medium">Conflict-of-interest attestation (required to accept)</p>
                    {([
                      ["a", "I have no financial interest in the outcome"],
                      ["b", "I have no prior engagement with either party"],
                      ["c", "I have no affiliation with either party"],
                    ] as const).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2">
                        <input type="checkbox" checked={c[k]} onChange={e => setC(k, e.target.checked)} />
                        {label}
                      </label>
                    ))}
                    <div className="flex flex-wrap gap-2 items-center">
                      <Button
                        size="sm"
                        disabled={accept.isPending || !(c.a && c.b && c.c)}
                        onClick={() => accept.mutate({
                          assignmentId: a.assignmentId,
                          coiAttestation: {
                            noFinancialInterest: c.a,
                            noPriorEngagement: c.b,
                            noPartyAffiliation: c.c,
                            attestedBy: "current-user",
                          },
                        })}
                      >Accept with COI attestation</Button>
                      <Input
                        className="w-64" placeholder="Decline reason"
                        value={reason[a.assignmentId] ?? ""}
                        onChange={e => setReason(s => ({ ...s, [a.assignmentId]: e.target.value }))}
                      />
                      <Button
                        size="sm" variant="outline"
                        disabled={decline.isPending || !(reason[a.assignmentId] ?? "").trim()}
                        onClick={() => decline.mutate({ assignmentId: a.assignmentId, reason: reason[a.assignmentId] })}
                      >Decline</Button>
                    </div>
                  </div>
                )}

                {a.status === "accepted" && (
                  <div className="space-y-2 border rounded p-3">
                    <p className="font-medium">Write determination (QPA-considered; UCR / billed charges / Medicare / Medicaid may not be the stated basis)</p>
                    <div className="flex gap-2 items-center">
                      <Input
                        className="w-40" placeholder="Amount in cents"
                        value={amount[a.assignmentId] ?? ""}
                        onChange={e => setAmount(s => ({ ...s, [a.assignmentId]: e.target.value }))}
                      />
                      <span className="text-muted-foreground">e.g. 260000 = $2,600.00</span>
                    </div>
                    <Textarea
                      placeholder="Determination rationale (min 100 characters)…"
                      value={rationale[a.assignmentId] ?? ""}
                      onChange={e => setRationale(s => ({ ...s, [a.assignmentId]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={writeDet.isPending || (rationale[a.assignmentId] ?? "").length < 100 || !(amount[a.assignmentId] ?? "").trim()}
                      onClick={() => writeDet.mutate({
                        assignmentId: a.assignmentId,
                        amountCents: Number(amount[a.assignmentId]),
                        rationale: rationale[a.assignmentId],
                        qpaConsidered: true,
                      })}
                    >Issue determination</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </DashboardLayout>
  );
}
