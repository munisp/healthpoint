CREATE TABLE "document_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"documentId" varchar(64) NOT NULL,
	"disputeId" varchar(64) NOT NULL,
	"versionNumber" integer DEFAULT 1 NOT NULL,
	"s3Key" varchar(512) NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileSize" integer,
	"mimeType" varchar(128),
	"uploadedBy" varchar(64) NOT NULL,
	"uploadedAt" timestamp DEFAULT now(),
	"changeNote" text,
	"isLatest" boolean DEFAULT true
);
--> statement-breakpoint
CREATE INDEX "doc_versions_documentId_idx" ON "document_versions" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "doc_versions_disputeId_idx" ON "document_versions" USING btree ("disputeId");--> statement-breakpoint
CREATE INDEX "doc_versions_latest_idx" ON "document_versions" USING btree ("documentId","isLatest");