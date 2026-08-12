ALTER TABLE "disputes" ADD COLUMN "determinationWinner" varchar(32);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "dispute_drafts_user_idx" ON "dispute_drafts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "dispute_drafts_lastSaved_idx" ON "dispute_drafts" USING btree ("lastSavedAt");--> statement-breakpoint
CREATE INDEX "disputes_createdAt_idx" ON "disputes" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "disputes_billedAmount_idx" ON "disputes" USING btree ("billedAmount");--> statement-breakpoint
CREATE INDEX "disputes_respondingName_idx" ON "disputes" USING btree ("respondingPartyName");--> statement-breakpoint
CREATE INDEX "idr_entities_name_idx" ON "idr_entities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idr_entities_active_idx" ON "idr_entities" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idr_entities_expiry_idx" ON "idr_entities" USING btree ("certificationExpiry");