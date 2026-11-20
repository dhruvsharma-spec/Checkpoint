-- Team ownership on activities; end time is required.
ALTER TABLE `Activity` ADD COLUMN `team` VARCHAR(191) NOT NULL DEFAULT '';

-- Existing rows without an end time get start + 1 hour so the NOT NULL constraint can apply.
UPDATE `Activity` SET `endsAt` = DATE_ADD(`startsAt`, INTERVAL 1 HOUR) WHERE `endsAt` IS NULL;

ALTER TABLE `Activity` MODIFY `endsAt` DATETIME(3) NOT NULL;

CREATE INDEX `Activity_team_idx` ON `Activity`(`team`);
