CREATE TABLE `audio_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`read_id` integer NOT NULL,
	`segment_index` integer NOT NULL,
	`text` text NOT NULL,
	`audio_path` text,
	`word_timings_json` text,
	`generated_at` integer,
	FOREIGN KEY (`read_id`) REFERENCES `reads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`read_id` integer NOT NULL,
	`segment_index` integer NOT NULL,
	`word_offset` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`read_id`) REFERENCES `reads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`source_url` text,
	`file_name` text,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`progress_segment` integer DEFAULT 0,
	`progress_word` integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `voices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`wav_path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voices_name_unique` ON `voices` (`name`);