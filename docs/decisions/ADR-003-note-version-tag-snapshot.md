# ADR-003: NoteVersion Captures a Tag-Id Snapshot (restore re-applies tags)

**Status:** Accepted
**Date:** 2026-06-23
**Ticket:** AB-1009
**Extends:** SDS §3 (NoteVersion model), §6.7 (version detail shape), §9 (version design); FRS-8.4 (restore semantics)

---

## Context

FRS-8.4 specifies that restoring a version "sets the note's current title/content to the chosen
version." The SDS hardens this into a `NoteVersion` model carrying only `title`, `contentJson`,
and `contentText` (SDS §3) — tags are **not** part of a version snapshot. Under that model, a
restore returns the note's text to an earlier state but leaves its **tag associations** at
whatever they currently are.

During AB-1009 clarification the product decision was that restore should reproduce the note's
state at that version **including its tags** — "upon restoring that version we can get the exact
tags that were there." The existing schema cannot express this: `NoteTag` rows describe only the
note's *live* associations, and a version row stores no tag information at all.

A second, related question is **when** a version (and therefore its tag snapshot) is captured.
FRS-8.1 says "on every save." A `PATCH` that changes only `tagIds` (no title/content change) is
a borderline "save". Capturing a version on every tag toggle would produce many near-duplicate
snapshots whose only difference is tags, and would couple version count to tag-editing UX.

## Decision

### 1. Versions store a denormalized tag-id snapshot

`NoteVersion` gains a `tagIds String[] @default([])` column — a snapshot of the note's tag-id set
**as of the moment the version was captured**.

```prisma
model NoteVersion {
  // … existing fields …
  tagIds String[] @default([])   // denormalized snapshot; NOT FK-constrained
}
```

Migration (additive, non-breaking):

```sql
ALTER TABLE "NoteVersion" ADD COLUMN "tagIds" TEXT[] NOT NULL DEFAULT '{}';
```

The column is **intentionally not foreign-key constrained**. A `NoteVersionTag` join table would
cascade-delete the snapshot when a tag is deleted (FRS-5.5), destroying the historical record. A
plain id array is immune to later tag deletion and faithfully records what was attached at the time.

### 2. Restore re-applies only the *surviving owned* subset

On restore the service reconciles the snapshot against live tags via the existing
`notesRepo.findOwnedTagIds(userId, version.tagIds)`:

- ids that still exist and are owned by the caller → re-attached (full-replace of the note's tag set);
- ids for tags deleted since → **silently dropped** (a deleted tag cannot be resurrected — FRS-5.5).

The **new** version recorded by the restore stores the *applied* (surviving) subset, so history
stays truthful — it never claims a tag that is no longer applied.

### 3. Tag-only edits do not create a version

Per the snapshot-trigger clarification, a version is captured on **create** (always) and on
**update only when `title` or `content` changes**. A tag-only or no-op `PATCH` writes no version.
Consequently a version's `tagIds` reflect the associations **as of the last title/content save**
(or restore), not every intermediate tag toggle. This keeps "save" meaningful and version count
bounded to content history while still letting restore reproduce a coherent past state.

## Consequences

- **SDS §3** (`NoteVersion` model), **§6.7** (version-detail response gains `tagIds`), and **§9**
  (version design — snapshot captures tags) are extended by this decision. This ADR is the
  authoritative record until those sections are synced when the AB-1009 change is applied/archived.
- **FRS-8.4** is extended: restore reproduces title, content, **and** the surviving tag set. FRS §8
  / §12 should gain a reference line to this ADR at sync time.
- A **new migration** (`note_version_tag_ids`) is required; `prisma generate` must follow so the
  client type carries `tagIds`. The change is additive — existing rows default to `'{}'`.
- The `version-history` and `note-crud` delta specs (AB-1009) encode the behavior: detail exposes
  `tagIds`; restore re-applies the surviving subset and records it on the new version; the
  "drops tags that have since been deleted" scenario is unit-tested.
- **Limitation accepted:** a tag deleted after a snapshot is unrecoverable on restore. Resurrecting
  tags (e.g. snapshotting name+color and recreating them) is explicitly out of scope — it would
  contradict FRS-5.5 and surprise users.
- A version's tag snapshot can lag a subsequent tag-only edit (decision 3). Restoring the most-recent
  version is rejected as a no-op (`422 VERSION_ALREADY_CURRENT`, AB-1009 spec), so this lag is not
  observable through the restore path in normal use.
