/**
 * J16–J17: patient/cross-side journeys (notifications, email prefs, watchlist,
 * dispute drafts + convert-to-dispute).
 */
import type { Journey } from "../framework";
import { createJourneyDispute } from "./helpers";

export const j16: Journey = {
  id: "J16",
  title: "Patient-facing: notifications read/markRead/markAllRead + email prefs + watchlist",
  actor: "patient",
  description:
    "notifications.list/markRead/markAllRead, emailPrefs.upsert/get, watchlist.add/isWatching/list/remove — all persisted and re-read.",
  steps: [
    {
      name: "notifications-lifecycle",
      async run(ctx) {
        // Generate a notification for the provider user via a dispute create.
        const d = await createJourneyDispute(ctx, "j16");
        (ctx as unknown as { _d: string })._d = d.id;
        const providerNotifs = await ctx.provider.notifications.list({ unreadOnly: true });
        ctx.assert(providerNotifs.length >= 1, "dispute create emitted unread notification", {
          count: providerNotifs.length,
        });
        const first = providerNotifs[0];
        await ctx.provider.notifications.markRead({ id: first.id });
        const afterOne = await ctx.provider.notifications.list({ unreadOnly: true });
        ctx.assert(
          !afterOne.some(n => n.id === first.id),
          "marked notification no longer unread"
        );
        const cleared = await ctx.provider.notifications.markAllRead();
        ctx.assert(typeof cleared.count === "number", "markAllRead returns count");
        const afterAll = await ctx.provider.notifications.list({ unreadOnly: true });
        ctx.assertEqual(afterAll.length, 0, "no unread notifications remain");
        return { evidence: { cleared: cleared.count } };
      },
    },
    {
      name: "email-preferences",
      async run(ctx) {
        const upsert = await ctx.patient.emailPrefs.upsert({
          digestFrequency: "weekly",
          notifyOnNewDispute: true,
          notifyOnStatusChange: true,
          notifyOnDeadlineApproach: true,
          notifyOnDetermination: true,
          notifyOnSLABreach: false,
          digestTime: "09:30",
          digestDayOfWeek: 2,
        });
        ctx.assert(upsert.success === true, "email prefs upserted");
        const prefs = await ctx.patient.emailPrefs.get();
        ctx.assert(prefs !== null, "prefs persisted");
        ctx.assertEqual(prefs!.digestFrequency, "weekly", "digest frequency persisted");
        ctx.assertEqual(prefs!.notifyOnSLABreach, false, "SLA breach opt-out persisted");
        // Idempotent upsert (update path).
        await ctx.patient.emailPrefs.upsert({
          digestFrequency: "daily",
          notifyOnNewDispute: true,
          notifyOnStatusChange: true,
          notifyOnDeadlineApproach: true,
          notifyOnDetermination: true,
          notifyOnSLABreach: true,
          digestTime: "08:00",
          digestDayOfWeek: 1,
        });
        const updated = await ctx.patient.emailPrefs.get();
        ctx.assertEqual(updated!.digestFrequency, "daily", "prefs update persisted");
        return { evidence: { digestFrequency: updated!.digestFrequency } };
      },
    },
    {
      name: "watchlist-add-verify-remove",
      async run(ctx) {
        const disputeId = (ctx as unknown as { _d: string })._d;
        const added = await ctx.provider.watchlist.add({
          disputeId, note: `watching ${ctx.runId}`,
        });
        ctx.assert(added.disputeId === disputeId, "watchlist entry created");
        const watching = await ctx.provider.watchlist.isWatching({ disputeId });
        ctx.assert(watching === true, "isWatching true after add");
        // Duplicate add must CONFLICT.
        let conflict = false;
        try {
          await ctx.provider.watchlist.add({ disputeId });
        } catch (err) {
          conflict = (err as { code?: string })?.code === "CONFLICT";
        }
        ctx.assert(conflict, "duplicate watchlist add rejected with CONFLICT");
        const list = await ctx.provider.watchlist.list();
        ctx.assert(
          list.some(e => e.disputeId === disputeId && e.dispute !== null),
          "watchlist list joins dispute summary"
        );
        await ctx.provider.watchlist.remove({ disputeId });
        const afterRemove = await ctx.provider.watchlist.isWatching({ disputeId });
        ctx.assert(afterRemove === false, "isWatching false after remove");
        return { evidence: { watchlistSize: list.length } };
      },
    },
  ],
};

export const j17: Journey = {
  id: "J17",
  title: "Dispute drafts: create/update/delete + convert to dispute",
  actor: "provider",
  description:
    "drafts.save/get/delete round-trip, then convert draft form data into a real disputes.create and verify persistence.",
  steps: [
    {
      name: "save-and-update-draft",
      async run(ctx) {
        await ctx.provider.drafts.save({
          wizardStep: 2,
          formData: {
            initiatingPartyName: `Draft Provider ${ctx.ns("j17")}`,
            serviceType: "emergency_medicine",
            billedAmount: "3333.00",
          },
        });
        const draft = await ctx.provider.drafts.get();
        ctx.assert(draft !== null, "draft persisted");
        ctx.assertEqual(draft!.currentStep, 2, "wizard step persisted");
        await ctx.provider.drafts.save({
          wizardStep: 4,
          formData: {
            initiatingPartyName: `Draft Provider ${ctx.ns("j17")}`,
            serviceType: "emergency_medicine",
            billedAmount: "3333.00",
            cptCodes: ["99285"],
            patientState: "FL",
          },
        });
        const updated = await ctx.provider.drafts.get();
        ctx.assertEqual(updated!.currentStep, 4, "draft updated (upsert)");
        ctx.assert(
          JSON.stringify(updated!.formData).includes("99285"),
          "form data persisted"
        );
        return { evidence: { wizardStep: updated!.currentStep } };
      },
    },
    {
      name: "convert-draft-to-dispute",
      async run(ctx) {
        const draft = await ctx.provider.drafts.get();
        ctx.assert(draft !== null, "draft available for conversion");
        const form = draft!.formData as Record<string, unknown>;
        const dispute = await ctx.provider.disputes.create({
          initiatingPartyType: "provider",
          initiatingPartyName: String(form.initiatingPartyName),
          respondingPartyType: "payer",
          respondingPartyName: "Journey Payer",
          serviceType: "emergency_medicine",
          serviceDate: new Date(Date.now() - 7 * 86400_000).toISOString(),
          patientState: String(form.patientState ?? "FL"),
          facilityState: String(form.patientState ?? "FL"),
          cptCodes: (form.cptCodes as string[]) ?? ["99285"],
          billedAmount: String(form.billedAmount),
          notes: `converted from draft (journey j17, ${ctx.runId})`,
        });
        ctx.assert(dispute.id.length > 0, "dispute created from draft data");
        (ctx as unknown as { _d: string })._d = dispute.id;
        const full = await ctx.provider.disputes.getById({ id: dispute.id });
        ctx.assertEqual(full.patientState, "FL", "draft fields carried over");
        return { evidence: { disputeId: dispute.id } };
      },
    },
    {
      name: "delete-draft-and-verify",
      async run(ctx) {
        await ctx.provider.drafts.delete();
        const gone = await ctx.provider.drafts.get();
        ctx.assert(gone === null || gone === undefined, "draft deleted");
        // The converted dispute must survive draft deletion.
        const disputeId = (ctx as unknown as { _d: string })._d;
        const full = await ctx.provider.disputes.getById({ id: disputeId });
        ctx.assertEqual(full.id, disputeId, "converted dispute persists after draft delete");
        // Re-save works after delete (re-runnable).
        await ctx.provider.drafts.save({ wizardStep: 1, formData: { note: ctx.runId } });
        const again = await ctx.provider.drafts.get();
        ctx.assert(again !== null, "draft re-creatable after delete");
        return { evidence: { disputeId } };
      },
    },
  ],
};
