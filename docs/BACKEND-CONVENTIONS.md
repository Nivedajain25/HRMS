# Backend conventions (apps/api)

Every module follows the same layering:

```
routes/<module>.routes.ts   → createModule() + route() specs (auth, permissions, Zod validation, Swagger)
controllers/<module>.controller.ts → thin: handle()/handlePaged()/handleCreated() wrappers
services/<module>.service.ts → all business logic; first argument is always `ctx: RequestContext`
models/*.model.ts           → Mongoose schemas (already defined for every module)
```

## Routes

```ts
import { createModule } from './registry';
export const leaveModule = createModule('Leave', '/api/v1/leaves');
leaveModule.route(
  { method: 'post', path: '/:id/approve', summary: 'Approve leave', permissions: ['leave:approve'], params: idParam, body: commentBody },
  leaveController.approve,
);
```

- `permissions` = all required, `anyPermission` = at least one. Omit both for self-service endpoints and enforce scope in the service.
- `body` / `query` / `params` are Zod schemas (prefer those in `@stencil/shared`). Parsed values: `body<T>(req)`, `query<T>(req)` from `middleware/validate`.
- Routes are mounted in `routes/index.ts` (add the exported module to the `modules` array).
- File uploads: `before: [uploadSingle()]`, then `detectAndValidateMime(req.file, DOCUMENT_MIME_TYPES)` in the service.

## Controllers

```ts
export const leaveController = {
  list: handlePaged((ctx, req) => leave.list(ctx, query(req))),
  approve: handle((ctx, req) => leave.approve(ctx, idOf(req), body(req)), 'Leave approved'),
};
```
Streaming/binary responses (PDF, CSV) write to `res` directly using `getCtx(req)`.

## Multi-tenancy (mandatory)

- **Every** query includes `organizationId: ctx.organizationId`. Never read an organization id from the request.
- Validate referenced ids with `assertRefsInOrg(ctx.organizationId, input, [...keys])` (services/refs.service.ts) before saving.
- Not-found and foreign records both return 404 (`notFound('Entity')`).

## Data scope (IDOR protection)

- List endpoints: `const scope = await resolveEmployeeScope(ctx, '<module>:read', q.scope)` then `applyScope(filter, scope)`.
  `<module>:read` → org-wide; `team:view` → self + reports; otherwise self only.
- Single record endpoints: `await assertEmployeeAccess(ctx, record.employeeId, '<module>:read')`.
- Salary/payroll data is only visible to the employee themself or `salary:read` / `payroll:read` holders (managers never see salary).

## Workflows

- Allowed transitions live in `@stencil/shared` (`LEAVE_WORKFLOW`, `EXPENSE_WORKFLOW`, `PAYROLL_WORKFLOW`, `ASSET_WORKFLOW`, `CANDIDATE_PIPELINE`, `OFFBOARDING_WORKFLOW`, ...). Always check `WORKFLOW.can(from, to)` and throw `invalidTransition(entity, from, to)`.
- Multi-step approvals (leave, regularization, expense) use `services/approval.service.ts`:
  `initApproval(doc, org.settings.approvals.<type>, employee)` on submit, `applyDecision(ctx, doc, employee, policy, 'APPROVE'|'REJECT', comment)` on act, `approvalQueueFilter(ctx, policy)` for "awaiting me" lists, `closeApproval(doc)` on cancel.

## Cross-cutting services

| Need | Use |
| --- | --- |
| Atomic multi-document writes | `withTransaction(async (session) => { ... })` — pass `session` to every op |
| Audit trail | `await audit(ctx, { action, module, recordId, recordLabel, oldValues, newValues })` (+ `diff(before, after)`) |
| Notifications (in-app + email by preference) | `notify({ organizationId, userIds, type, title, message, link, excludeUserId: ctx.userId })`; helpers `userIdsForEmployees`, `userIdsWithPermission`, `managerUserId` |
| Emails | `sendEmail(to, template, data, orgId)` (templates in `emails/templates.ts`) |
| Mobile push | `sendPush(userIds, { title, body, data })` (services/push.service.ts, Expo; `notify()` already pushes to users with in-app enabled). Tests: `configurePush({ enabled, transport })` |
| Mobile auth | `X-Client: mobile` → refresh token in body instead of cookie (`isMobileClient(req)`, `csrfOrMobileBody(schema)` in middleware/client.ts) |
| Dates | `utils/dates.ts` — calendar dates are `YYYY-MM-DD` keys stored via `dateOnly(key)` (00:00 UTC); instants are UTC; use `todayKey(tz)`, `dateKeyInTz`, `zonedInstant` with the org timezone |
| Working days / holidays | `buildWorkCalendar(orgId, from, to, employeeId)` (services/calendar.service.ts) |
| Sequences (EXP-0001...) | `nextSequence(orgId, key)` + `formatSequence` (utils/counter.ts) |
| Simple master-data CRUD | `createCrudService({...})` (services/crud.service.ts) |
| Pagination | `paginate(model, { filter, page, limit, sort, populate })`, `buildSort`, `searchFilter` |
| Errors | `badRequest`, `forbidden`, `notFound`, `conflict`, `unprocessable`, `invalidTransition` (utils/errors.ts) |
| Background / scheduled jobs | `defineScheduledJob({ name, schedule, handler })` (jobs/index.ts), `enqueue(name, data)` |

## Responses

`{ success: true, data, message? }`, paginated `{ success, data: [], pagination }`, errors `{ success: false, message, code, errors: [{ path, message }] }`.

## Testing

- Integration tests in `apps/api/tests/integration/*.test.ts` use supertest against `createApp()` and an in-memory MongoDB replica set (transactions work).
- Helpers (`tests/helpers.ts`): `registerOrg()`, `createEmployeeUser(adminToken, { roles: ['manager'], managerId })`, `as(token).get/post/patch/delete`, `roleIds`, `tokenFromEmail`.
- Run one file: `corepack pnpm --filter @stencil/api exec vitest run tests/integration/leave.test.ts`
- Typecheck: `corepack pnpm --filter @stencil/api typecheck`

## Local machine note

The repository drive (D:) has ~1 GB. Never run `npm install`. Dependencies are managed with pnpm (`corepack pnpm ...`) whose store lives on C:.
