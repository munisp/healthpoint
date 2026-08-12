CREATE TABLE `dispute_documents` (
	`id` varchar(64) NOT NULL,
	`disputeId` varchar(64) NOT NULL,
	`documentType` varchar(64) NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileSize` int,
	`mimeType` varchar(128),
	`s3Key` varchar(512),
	`uploadedBy` varchar(64),
	`uploadedAt` timestamp DEFAULT (now()),
	`description` text,
	CONSTRAINT `dispute_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dispute_events` (
	`id` varchar(64) NOT NULL,
	`disputeId` varchar(64) NOT NULL,
	`step` enum('STEP_01_OPEN_NEGOTIATION_INITIATED','STEP_02_OPEN_NEGOTIATION_PERIOD','STEP_03_OPEN_NEGOTIATION_FAILED','STEP_04_IDR_INITIATED','STEP_05_IDR_NOTICE_SENT','STEP_06_IDR_ENTITY_SELECTION','STEP_07_IDR_ENTITY_SELECTED','STEP_08_ELIGIBILITY_REVIEW','STEP_09_OFFER_SUBMISSION','STEP_10_QPA_DISCLOSURE','STEP_11_ADDITIONAL_INFORMATION','STEP_12_ARBITRATION_REVIEW','STEP_13_DETERMINATION_ISSUED','STEP_14_PAYMENT_DETERMINATION','STEP_15_PAYMENT_MADE','STEP_16_ADMINISTRATIVE_FEE_PAID','STEP_17_DISPUTE_CLOSED','STEP_18_APPEAL_FILED','STEP_19_APPEAL_RESOLVED') NOT NULL,
	`previousStep` enum('STEP_01_OPEN_NEGOTIATION_INITIATED','STEP_02_OPEN_NEGOTIATION_PERIOD','STEP_03_OPEN_NEGOTIATION_FAILED','STEP_04_IDR_INITIATED','STEP_05_IDR_NOTICE_SENT','STEP_06_IDR_ENTITY_SELECTION','STEP_07_IDR_ENTITY_SELECTED','STEP_08_ELIGIBILITY_REVIEW','STEP_09_OFFER_SUBMISSION','STEP_10_QPA_DISCLOSURE','STEP_11_ADDITIONAL_INFORMATION','STEP_12_ARBITRATION_REVIEW','STEP_13_DETERMINATION_ISSUED','STEP_14_PAYMENT_DETERMINATION','STEP_15_PAYMENT_MADE','STEP_16_ADMINISTRATIVE_FEE_PAID','STEP_17_DISPUTE_CLOSED','STEP_18_APPEAL_FILED','STEP_19_APPEAL_RESOLVED'),
	`eventType` varchar(64) NOT NULL,
	`description` text NOT NULL,
	`performedBy` varchar(64),
	`performedByName` varchar(255),
	`metadata` json,
	`createdAt` timestamp DEFAULT (now()),
	CONSTRAINT `dispute_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dispute_offers` (
	`id` varchar(64) NOT NULL,
	`disputeId` varchar(64) NOT NULL,
	`offerType` enum('initiating_party','responding_party','qpa','determination') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`rationale` text,
	`supportingDocIds` json,
	`submittedBy` varchar(64),
	`submittedAt` timestamp DEFAULT (now()),
	`isAccepted` boolean DEFAULT false,
	CONSTRAINT `dispute_offers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `disputes` (
	`id` varchar(64) NOT NULL,
	`referenceNumber` varchar(32) NOT NULL,
	`initiatingPartyId` varchar(64) NOT NULL,
	`initiatingPartyType` enum('provider','facility','payer','aggregator') NOT NULL,
	`initiatingPartyName` varchar(255) NOT NULL,
	`initiatingPartyNpi` varchar(20),
	`respondingPartyId` varchar(64),
	`respondingPartyType` enum('provider','facility','payer','aggregator'),
	`respondingPartyName` varchar(255),
	`respondingPartyNpi` varchar(20),
	`serviceType` enum('emergency_medicine','anesthesiology','pathology','radiology','neonatology','surgery','hospitalist','air_ambulance','ground_ambulance','other') NOT NULL,
	`serviceDate` timestamp NOT NULL,
	`patientState` varchar(2) NOT NULL,
	`facilityState` varchar(2) NOT NULL,
	`cptCodes` json NOT NULL,
	`icd10Codes` json,
	`billedAmount` decimal(12,2) NOT NULL,
	`qpaAmount` decimal(12,2),
	`initiatingPartyOffer` decimal(12,2),
	`respondingPartyOffer` decimal(12,2),
	`determinationAmount` decimal(12,2),
	`adminFeeAmount` decimal(12,2),
	`currentStep` enum('STEP_01_OPEN_NEGOTIATION_INITIATED','STEP_02_OPEN_NEGOTIATION_PERIOD','STEP_03_OPEN_NEGOTIATION_FAILED','STEP_04_IDR_INITIATED','STEP_05_IDR_NOTICE_SENT','STEP_06_IDR_ENTITY_SELECTION','STEP_07_IDR_ENTITY_SELECTED','STEP_08_ELIGIBILITY_REVIEW','STEP_09_OFFER_SUBMISSION','STEP_10_QPA_DISCLOSURE','STEP_11_ADDITIONAL_INFORMATION','STEP_12_ARBITRATION_REVIEW','STEP_13_DETERMINATION_ISSUED','STEP_14_PAYMENT_DETERMINATION','STEP_15_PAYMENT_MADE','STEP_16_ADMINISTRATIVE_FEE_PAID','STEP_17_DISPUTE_CLOSED','STEP_18_APPEAL_FILED','STEP_19_APPEAL_RESOLVED') NOT NULL DEFAULT 'STEP_01_OPEN_NEGOTIATION_INITIATED',
	`status` enum('open_negotiation','idr_initiated','idr_entity_selection','eligibility_review','offer_submission','under_arbitration','determination_issued','payment_pending','closed','appealed','ineligible') NOT NULL DEFAULT 'open_negotiation',
	`idrEntityId` varchar(64),
	`idrEntityName` varchar(255),
	`openNegotiationDeadline` timestamp,
	`idrInitiationDeadline` timestamp,
	`entitySelectionDeadline` timestamp,
	`eligibilityDeadline` timestamp,
	`offerSubmissionDeadline` timestamp,
	`additionalInfoDeadline` timestamp,
	`determinationDeadline` timestamp,
	`paymentDeadline` timestamp,
	`isEligible` boolean,
	`ineligibilityReason` text,
	`determinationBasis` text,
	`notes` text,
	`createdBy` varchar(64),
	`createdAt` timestamp DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`closedAt` timestamp,
	CONSTRAINT `disputes_id` PRIMARY KEY(`id`),
	CONSTRAINT `disputes_referenceNumber_unique` UNIQUE(`referenceNumber`)
);
--> statement-breakpoint
CREATE TABLE `idr_entities` (
	`id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`certificationNumber` varchar(64),
	`certificationExpiry` timestamp,
	`specialties` json,
	`states` json,
	`contactEmail` varchar(320),
	`contactPhone` varchar(20),
	`website` varchar(512),
	`avgResolutionDays` int,
	`totalCasesHandled` int DEFAULT 0,
	`isActive` boolean DEFAULT true,
	`createdAt` timestamp DEFAULT (now()),
	CONSTRAINT `idr_entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `idr_entities_certificationNumber_unique` UNIQUE(`certificationNumber`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(64) NOT NULL,
	`disputeId` varchar(64) NOT NULL,
	`userId` varchar(64),
	`notificationType` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`dueDate` timestamp,
	`isRead` boolean DEFAULT false,
	`createdAt` timestamp DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp DEFAULT (now()),
	`lastSignedIn` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `docs_dispute_idx` ON `dispute_documents` (`disputeId`);--> statement-breakpoint
CREATE INDEX `events_dispute_idx` ON `dispute_events` (`disputeId`);--> statement-breakpoint
CREATE INDEX `events_step_idx` ON `dispute_events` (`step`);--> statement-breakpoint
CREATE INDEX `offers_dispute_idx` ON `dispute_offers` (`disputeId`);--> statement-breakpoint
CREATE INDEX `disputes_status_idx` ON `disputes` (`status`);--> statement-breakpoint
CREATE INDEX `disputes_step_idx` ON `disputes` (`currentStep`);--> statement-breakpoint
CREATE INDEX `disputes_initiating_idx` ON `disputes` (`initiatingPartyId`);--> statement-breakpoint
CREATE INDEX `disputes_responding_idx` ON `disputes` (`respondingPartyId`);--> statement-breakpoint
CREATE INDEX `disputes_ref_idx` ON `disputes` (`referenceNumber`);--> statement-breakpoint
CREATE INDEX `notif_dispute_idx` ON `notifications` (`disputeId`);--> statement-breakpoint
CREATE INDEX `notif_user_idx` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `notif_read_idx` ON `notifications` (`isRead`);