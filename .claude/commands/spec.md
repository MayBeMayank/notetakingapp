Run OpenSpec proposal creation for: $ARGUMENTS

Steps:
1. Read docs/FRS.md - find every acceptance criterion for this ticket
2. Read docs/SDS.md - find API contracts, error codes, and DB changes for this ticket
3. Read AGENTS.md - understand architecture constraints
4. Ask 3 to 5 clarifying questions about edge cases before writing anything
5. Create folder openspec/changes/$ARGUMENTS/ if it does not exist
6. Identify 1-3 capability names in kebab-case this ticket introduces or modifies (e.g. monorepo-scaffold, user-auth, note-crud)

7. Generate openspec/changes/$ARGUMENTS/proposal.md with these exact sections:

   ## Why
   (motivation — what problem this ticket solves, why it is needed now)

   ## What Changes
   (FRS references this ticket covers; what is in scope and what is explicitly out of scope)

   ## Capabilities
   ### New Capabilities
   - `<capability-name>`: <one-line description — each name here creates a specs/<name>/spec.md>
   ### Modified Capabilities
   - (only if requirements in an existing openspec/specs/<name>/ are changing; leave empty otherwise)

   ## Impact
   (API Delta from SDS — new or modified endpoints with request/response shapes;
    DB Changes — new tables, columns, or migrations; "None" if not applicable;
    Affected layers and key assumptions)

8. For EACH capability listed under New Capabilities, generate openspec/changes/$ARGUMENTS/specs/<capability-name>/spec.md.
   This file MUST use OpenSpec delta headers and requirement blocks — not prose or tables.
   Every FRS acceptance criterion for this ticket must appear as a ### Requirement: block
   with at least one #### Scenario: block. Include edge cases from the clarifications.

   Required format (do not deviate):

   ## ADDED Requirements

   ### Requirement: <requirement name>
   <one or two sentence description of the requirement>

   #### Scenario: <scenario name>
   - **WHEN** <trigger condition or action>
   - **THEN** <expected observable outcome>

   (add more #### Scenario: blocks under the same Requirement for each distinct edge case)
   (add more ### Requirement: blocks for each distinct requirement)
   (use ## MODIFIED Requirements or ## REMOVED Requirements if the ticket changes existing behavior)

9. Do NOT write any implementation code
10. Wait for human approval of all the above artifacts (proposal.md, specs/<capability>/spec.md) before stopping

Format: /spec AB-1002
