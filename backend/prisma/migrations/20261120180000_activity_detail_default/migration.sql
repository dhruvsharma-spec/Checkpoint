-- Align with schema.prisma (@default("")) when the activities table was created without a default on `detail`.
ALTER TABLE `Activity` MODIFY `detail` TEXT NOT NULL DEFAULT '';