# ADR-004: Version History Is Readable on a Soft-Deleted Note (restore blocked)

**Status:** Accepted
**Date:** 2026-06-23
**Ticket:** AB-1009
**Refines:** FRS-4.4.5 (no action on a soft-deleted note other than restore); FRS-8.2 / 8.3 (list/view versions)

---

## Context

FRS-4.4.5 states a user "SHALL NOT be able to act on (read/update/share) a soft-deleted note
other than to restore it," and the `note-crud` capability enforces this: `GET /api/notes/:id`
returns `404` for a trashed note. Version history (FRS §8) introduces three new operations on a
note — list versions, view a version, and restore a version — and FRS §8 does not say how they
behave when the underlying note is in the trash.

A literal reading of FRS-4.4.5 would `404` all three (a trashed note cannot be "read"). But the
intended UX is that a user inspecting trash should be able to **preview a note's history before
deciding whether to recover it** — exactly the moment version reads are most useful. Blocking
reads forces a recover-just-to-look round-trip that then dirties the note's active state.

"Restore a version," by contrast, **mutates** the note's current title/content/tags. Allowing it
on a trashed note would resurrect content into a note that is itself deleted — an incoherent state
that the soft-delete rules (FRS-4.3.3 / 4.4.5) exist to prevent.

## Decision

Scope the FRS-4.4.5 read prohibition so it does **not** extend to *version-history reads*, while
keeping every mutation blocked:

- **`GET /api/notes/:id/versions`** and **`GET /api/notes/:id/versions/:versionId`** resolve the
  parent note scoped to the caller **regardless of `deletedAt`**. They succeed (`200`) for a
  trashed note the caller owns, and return `404` only when no such owned note exists (no existence
  leak, FRS-9.1).
- **`POST /api/notes/:id/versions/:versionId/restore`** additionally requires `deletedAt IS NULL`.
  On a trashed note it is rejected `422` with `{ error: { code: "NOTE_DELETED", … } }` — the note
  must first be restored to active state (reusing the same code as a deleted-note update).

This is a deliberate, **owner-only** refinement: version reads never expose another user's data,
and never expose a note to a non-owner.

## Consequences

- **FRS-4.4.5** is refined: its read prohibition is read as covering the *note resource and its
  content endpoints*, not the owner's own *version-history reads*. FRS §8 / §12 should gain a
  reference line to this ADR at sync time; this ADR is the authoritative record meanwhile.
- The `version-history` delta spec (AB-1009) encodes both behaviors as scenarios: "List/View
  versions of a soft-deleted note is allowed" and "Restore on a soft-deleted note rejected (422
  NOTE_DELETED)."
- Implementation: version `list`/`view` use `findNoteByIdForUser` (which does **not** filter
  `deletedAt`), unlike `getNoteById` which `404`s trashed notes. Restore adds the `deletedAt`
  guard before any write. Integration tests assert `200` for trashed reads and `422` for trashed
  restore.
- No change to soft-delete semantics elsewhere: list, single-note read, search, and sharing
  continue to exclude/deny soft-deleted notes (FRS-4.4.2 / 4.4.5).
