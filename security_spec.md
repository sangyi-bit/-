# Firestore Security Specification

## 1. Data Invariants
1. Every `patrolLogs/{logId}` and `monthlyReports/{reportId}` document must belong to an authenticated, email-verified user (`request.auth != null && request.auth.token.email_verified == true`), with `ownerId == request.auth.uid`.
2. Users may only read, list, create, update, and delete documents where `ownerId == request.auth.uid`. Blanket queries without `ownerId == request.auth.uid` are rejected.
3. Document IDs (`logId`, `reportId`) must satisfy `^[a-zA-Z0-9_\-]+$` and length `<= 128`.
4. All strings have explicit `.size()` bounds; arrays (`actionItems`, `keyHighlights`, `recommendations`) are bounded to `<= 10` elements with first-element string/size verification.
5. `ownerId` and `createdAt` are immutable after creation; `createdAt` must equal `request.time` on create and `updatedAt` must equal `request.time` on both create and update.
6. Updates use explicit action branches (`updateDetails` or `toggleFollowUp` for `patrolLogs`; `regenerateReport` for `monthlyReports`) with `affectedKeys().hasOnly(...)` and strict schema validation.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Create `patrolLogs/log1` with `request.auth == null`.
2. **Unverified Email Write**: Create `patrolLogs/log2` where `request.auth.token.email_verified == false`.
3. **Identity Spoofing on Create**: Create `patrolLogs/log3` with `ownerId: "victim-uid"` while signed in as `"attacker-uid"`.
4. **Shadow / Ghost Field Injection**: Create `patrolLogs/log4` including extra field `isAdmin: true`.
5. **Invalid Document ID Poisoning**: Create `patrolLogs/bad$id!with.invalidChars` or 200-character ID.
6. **Client-Forged Timestamp**: Create `patrolLogs/log5` with client-supplied `createdAt: Timestamp(2020-01-01)` instead of `request.time`.
7. **Immortal Field Mutation**: Update `patrolLogs/log1` attempting to change `ownerId` or `createdAt`.
8. **Blanket List Scraping**: `list` query on `patrolLogs` without filtering `where("ownerId", "==", uid)`.
9. **Cross-User Read / Delete**: Authenticated user B attempts `get` or `delete` on user A's `patrolLogs/logA`.
10. **Enum Poisoning**: Create `patrolLogs/log6` with `patrolStatus: "INVALID_STATUS"` or `zoneCategory: "Unknown"`.
11. **Array / String Resource Exhaustion**: Create `patrolLogs/log7` with `actionItems` having 15 elements or `summary` exceeding 600 chars or `photoDataUrl` exceeding 350,000 chars.
12. **Type Poisoning on Update**: Update `patrolLogs/log1` setting `followUpResolved: "yes"` (string instead of boolean) or `totalCount: -1` in `monthlyReports`.
