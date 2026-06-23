-- AB-1009 / ADR-003: denormalized snapshot of the note's tag ids at each version.
-- Not FK-constrained so the snapshot survives later tag deletion (FRS-5.5).
-- AlterTable
ALTER TABLE "NoteVersion" ADD COLUMN "tagIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
