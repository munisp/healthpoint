/**
 * BillingTab — Phase 20-FE. Submitter invoicing + payment collection links,
 * wired to server/routers/submitter-billing.ts:
 *
 *   submitterBilling.generateInvoice / listInvoices / getInvoice /
 *   updateInvoiceStatus — invoice lifecycle (draft → sent → paid/void).
 *     Invoices are computed from platform determination outcomes ONLY;
 *     undetermined disputes are never billed (server-enforced).
 *   submitterBilling.createInvoicePaymentLink — Stripe Checkout link
 *     (card + ACH bank debit); only legal for status=sent (server-enforced).
 *   submitterBilling.getInvoicePaymentStatus — payment status. paidAt is
 *     webhook-only on the server; this UI never displays "paid" from a mere
 *     link creation.
 *
 * Fee policy copy (user-locked, mirrors the server module header): ACH
 * (bank debit) is the preferred payment method, there is NO surcharge, and
 * the platform absorbs processing fees. When Stripe is not configured the
 * UI says so honestly and points at manual collection instead of
 * pretending a link can be created.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import type { SubmitterClient } from "./SubmitterConsole";

type Invoice = {
  id: string;
  invoiceNumber: string;
  billingModel: string;
  status: string;
  periodStart: string | Date;
  periodEnd: string | Date;
  totalUsd: string;
  lineCount: number;
  issuedAt: string | Date | null;
  paidAt: string | Date | null;
  stripeSessionId: string | null;
  stripeStatus: string | null;
};

type InvoiceLine = {
  id: string;
  referenceNumber: string | null;
  awardUsd: string | null;
  chargeUsd: string;
  description: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  sent: "secondary",
  paid: "default",
  void: "destructive",
};

function MarkPaidButton({ invoiceId, onDone }: { invoiceId: string; onDone: () => void }) {
  const m = trpc.submitterBilling.updateInvoiceStatus.useMutation({
    onSuccess: () => { toast.success("Invoice marked paid (manual collection)"); onDone(); },
    onError: e => toast.error(e.message),
  });
  return (
    <Button size="sm" variant="outline" disabled={m.isPending}
      onClick={() => m.mutate({ invoiceId, status: "paid" })}>
      {m.isPending ? "Saving…" : "Mark paid (collected outside platform)"}
    </Button>
  );
}

function PaymentLinkPanel({ invoice }: { invoice: Invoice }) {
  const statusQ = trpc.submitterBilling.getInvoicePaymentStatus.useQuery({ invoiceId: invoice.id });
  const [link, setLink] = useState<string | null>(null);
  const createLink = trpc.submitterBilling.createInvoicePaymentLink.useMutation({
    onSuccess: r => {
      if (r.url) {
        setLink(r.url);
        navigator.clipboard?.writeText(r.url).then(
          () => toast.success(r.reused ? "Existing payment link copied" : "Payment link created and copied"),
          () => toast.success("Payment link created — copy it below"),
        );
      }
      statusQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  const ps = statusQ.data;
  const paid = invoice.status === "paid" || ps?.stripeStatus === "paid";
  const paidAt = ps?.paidAt ?? invoice.paidAt;

  return (
    <div className="border rounded-md p-3 space-y-2 bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Payment collection</span>
        {paid && (
          <Badge variant="default">
            Paid{paidAt ? ` — ${new Date(paidAt as string).toLocaleDateString()}` : ""}
          </Badge>
        )}
        {!paid && ps?.stripeStatus && <Badge variant="secondary">Stripe: {ps.stripeStatus}</Badge>}
        {ps?.manualCollection && (
          <Badge variant="outline">Manual collection (online payments not configured)</Badge>
        )}
      </div>

      {ps?.manualCollection && (
        <p className="text-xs text-muted-foreground max-w-2xl">
          Online payment links are not configured on this deployment, so this invoice is collected outside the
          platform (for example the client mails a check or pays by its own ACH). When payment arrives, mark the
          invoice paid — the audit trail records who marked it and when.
        </p>
      )}
      {ps && !ps.manualCollection && !paid && (
        <p className="text-xs text-muted-foreground max-w-2xl">
          Payment links open a secure checkout page. ACH (bank debit) is the preferred method; card is also
          accepted. There is no surcharge — the platform absorbs the processing fees, so your client pays exactly
          the invoice amount.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {invoice.status === "sent" && !paid && ps && !ps.manualCollection && (
          <Button size="sm" disabled={createLink.isPending}
            onClick={() => createLink.mutate({ invoiceId: invoice.id })}>
            {createLink.isPending ? "Creating…" : invoice.stripeSessionId ? "Copy payment link" : "Create payment link"}
          </Button>
        )}
        {invoice.status === "sent" && !paid && ps?.manualCollection && (
          <MarkPaidButton invoiceId={invoice.id} onDone={() => statusQ.refetch()} />
        )}
      </div>

      {link && (
        <div className="rounded border border-teal-200 bg-teal-50 p-2 space-y-1">
          <p className="text-xs text-teal-800 break-all font-mono">{link}</p>
          <Button size="sm" variant="secondary" className="text-xs"
            onClick={() => navigator.clipboard?.writeText(link).then(
              () => toast.success("Link copied"),
              () => toast.error("Copy failed — select the link manually"),
            )}>
            Copy link
          </Button>
        </div>
      )}
      {createLink.isError && createLink.error.data?.code === "PRECONDITION_FAILED" && (
        <p role="alert" className="text-xs text-muted-foreground">{createLink.error.message}</p>
      )}
    </div>
  );
}

function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const q = trpc.submitterBilling.getInvoice.useQuery({ invoiceId: invoice.id });
  const lines = (q.data?.lines ?? []) as InvoiceLine[];
  const fresh = (q.data?.invoice ?? invoice) as Invoice;
  const send = trpc.submitterBilling.updateInvoiceStatus.useMutation({
    onSuccess: () => { toast.success("Invoice marked sent"); q.refetch(); },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-3 mt-2">
      {fresh.status === "draft" && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={send.isPending}
            onClick={() => send.mutate({ invoiceId: invoice.id, status: "sent" })}>
            {send.isPending ? "Sending…" : "Mark as sent to client"}
          </Button>
          <span className="text-xs text-muted-foreground">Payment links can be created once the invoice is sent.</span>
        </div>
      )}
      {fresh.status !== "draft" && <PaymentLinkPanel invoice={fresh} />}
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading lines…</p>}
      {lines.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispute</TableHead>
              <TableHead>Award</TableHead>
              <TableHead>Charge</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map(l => (
              <TableRow key={l.id}>
                <TableCell className="font-mono text-xs">{l.referenceNumber ?? "—"}</TableCell>
                <TableCell>{l.awardUsd != null ? `$${Number(l.awardUsd).toFixed(2)}` : "—"}</TableCell>
                <TableCell>${Number(l.chargeUsd).toFixed(2)}</TableCell>
                <TableCell className="text-xs">{l.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function BillingTab({ clients }: { clients: SubmitterClient[] }) {
  const [clientId, setClientId] = useState("");
  const client = clients.find(c => c.id === clientId) ?? clients[0];
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const invoicesQ = trpc.submitterBilling.listInvoices.useQuery(
    { submitterClientId: client?.id ?? "" },
    { enabled: !!client },
  );
  const invoices = ((invoicesQ.data ?? []) as Invoice[]).slice()
    .sort((a, b) => String(b.invoiceNumber).localeCompare(String(a.invoiceNumber)));

  const generate = trpc.submitterBilling.generateInvoice.useMutation({
    onSuccess: r => {
      toast.success(`Draft invoice ${r.invoiceNumber} generated — ${r.lineCount} line${r.lineCount === 1 ? "" : "s"}, $${r.totalUsd.toFixed(2)}`);
      invoicesQ.refetch();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Client invoicing</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground max-w-3xl">
            Invoices are computed from real platform determination outcomes only — disputes without a
            determination are never billed. Every line names the dispute and the award it was computed from.
          </p>
          {!clients.length && (
            <p className="text-sm text-muted-foreground">No client links yet — invite a client on the Clients tab first.</p>
          )}
          {!!clients.length && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <Label className="text-xs">Client</Label>
                  <select className="border rounded px-2 py-1 text-sm bg-background block" value={client?.id ?? ""}
                    onChange={e => setClientId(e.target.value)} aria-label="Billing client">
                    {clients.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div><Label className="text-xs">Period start</Label><Input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} aria-label="Invoice period start" /></div>
                <div><Label className="text-xs">Period end</Label><Input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} aria-label="Invoice period end" /></div>
                <Button size="sm" variant="outline"
                  disabled={generate.isPending || !client || !periodStart || !periodEnd}
                  onClick={() => client && generate.mutate({
                    submitterClientId: client.id,
                    periodStart: new Date(`${periodStart}T00:00:00Z`),
                    periodEnd: new Date(`${periodEnd}T00:00:00Z`),
                  })}>
                  {generate.isPending ? "Generating…" : "Generate draft invoice"}
                </Button>
              </div>

              {invoicesQ.isLoading && <p className="text-sm text-muted-foreground">Loading invoices…</p>}
              {invoicesQ.isError && <p role="alert" className="text-sm text-destructive">{invoicesQ.error.message}</p>}
              {invoicesQ.data && invoices.length === 0 && (
                <p className="text-sm text-muted-foreground">No invoices for this client yet.</p>
              )}
              {invoices.map(inv => (
                <div key={inv.id} className="border rounded-md p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm">{inv.invoiceNumber}</span>
                    <Badge variant={STATUS_VARIANT[inv.status] ?? "outline"}>{inv.status}</Badge>
                    <span className="text-sm font-medium">${Number(inv.totalUsd).toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">
                      {inv.lineCount} line{inv.lineCount === 1 ? "" : "s"} · {inv.billingModel} ·{" "}
                      {new Date(inv.periodStart).toLocaleDateString()}–{new Date(inv.periodEnd).toLocaleDateString()}
                    </span>
                    <Button size="sm" variant="ghost" className="ml-auto"
                      onClick={() => setOpenInvoice(openInvoice === inv.id ? null : inv.id)}>
                      {openInvoice === inv.id ? "Hide" : "Details"}
                    </Button>
                  </div>
                  {openInvoice === inv.id && <InvoiceDetail invoice={inv} />}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
