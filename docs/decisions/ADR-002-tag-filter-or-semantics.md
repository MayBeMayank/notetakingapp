# ADR-002: Tag Filter Uses OR Semantics (not AND)

**Status:** Accepted
**Date:** 2026-06-22
**Ticket:** AB-1005
**Supersedes:** FRS §12 decision 4 (original "AND" ruling)

---

## Context

FRS-4.5.3 originally specified that multi-tag filtering on the notes list used **AND
semantics**: a note was returned only if it carried **every** supplied tag. This was recorded
as a confirmed, binding decision in FRS §12 (decision 4).

In practice the AND default is the wrong fit for how the notes list is browsed. The frontend
tag filter (AB-1011) is a multi-select of tag chips. The common user intent when selecting
several chips in a note/email/file-style app is "show me everything in any of these buckets" —
a broadening action — not "show me only notes that sit in all of these buckets at once," which
is a narrowing action that quickly yields empty results as more chips are added. AND filtering
also interacts poorly with discovery: adding a second tag almost always shrinks the result set,
which reads as "the filter is broken" to most users.

OR semantics matches the mental model of progressive disclosure (each added tag reveals more,
not less) and is the prevailing default in comparable products. AND-style narrowing remains a
possible future enhancement (e.g. an explicit "match all" toggle) but is out of scope here.

## Decision

Multi-tag filtering on `GET /api/notes` uses **OR semantics**:

- A note matches the `tags` filter if it carries **at least one** of the supplied tags.
- A note carrying more than one of the supplied tags is returned **exactly once**
  (results are de-duplicated by note id).
- The `total` in the pagination envelope counts each matching note once.

This composes with sorting and pagination unchanged (FRS-4.5.4).

### Query shape

OR resolves naturally to a set-union membership test, de-duplicated. Conceptually:

```sql
SELECT n.* FROM "Note" n
WHERE n."userId" = $userId
  AND n."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "NoteTag" nt
    WHERE nt."noteId" = n.id AND nt."tagId" = ANY($tagIds)
  )
ORDER BY ...
LIMIT ... OFFSET ...;
```

Using `EXISTS` (or a `DISTINCT` join) guarantees a note carrying several of the supplied tags
appears once. This is simpler than the AND form, which required a
`GROUP BY ... HAVING COUNT(DISTINCT tagId) = :n` intersection.

## Consequences

- **FRS-4.5.3** and **FRS §12 decision 4** are updated in place to read OR; this ADR is the
  authoritative record of the revision and its rationale.
- **SDS §6.3** documents the OR resolution and de-duplication contract; **SDS §12** lists
  "OR-semantics tag filtering" as the unit-tested business rule.
- The AB-1005 service must de-duplicate by note id so `total` and the page slice are correct.
- Unknown or non-owned tag ids in the filter simply contribute no matches (they cannot widen
  the union beyond the caller's own notes); they are not an error on the list endpoint.
- The unit test for tag filtering asserts OR semantics: a note with any one supplied tag is
  included, a note with several supplied tags appears once, and a note with none is excluded.
- Derived agent-instruction docs (`AGENTS.md`, `openspec/project.md`) are updated to match.
