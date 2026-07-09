CREATE TABLE `dispute_drafts` (
	`id` varchar(64) NOT NULL,
	`userId` varchar(64) NOT NULL,
	`currentWizardStep` int NOT NULL DEFAULT 1,
	`formData` json NOT NULL,
	`lastQpaValidatedAmount` decimal(12,2),
	`qpaValidationResult` json,
	`createdAt` timestamp DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dispute_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `idr_entities` ADD `maxConcurrentCases` int DEFAULT 50;--> statement-breakpoint
ALTER TABLE `idr_entities` ADD `currentActiveCases` int DEFAULT 0;--> statement-breakpoint
CREATE INDEX `drafts_user_idx` ON `dispute_drafts` (`userId`);