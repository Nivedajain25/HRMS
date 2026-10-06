# Frontend conventions (apps/web)

React 19 + Vite + TypeScript + Tailwind v4 + React Router 7 + TanStack Query 5 + Zustand + React Hook Form + Zod 4.

## Structure

```
src/features/<feature>/
  api.ts              types + TanStack Query hooks for the feature
  *-page.tsx          route pages (lazy-loaded)
  components/         feature components (incl. employee-<x>-tab.tsx used by the employee profile)
  routes.tsx          export const routes: RouteObject[]  (mounted by src/routes/router.tsx)
```

The reference implementation is `src/features/employees/` (list page, drawer form, profile with tabs, master-data pages).

## Building blocks

| Need | Use |
| --- | --- |
| HTTP | `get`, `getPaged`, `post`, `patch`, `put`, `del`, `upload`, `downloadFile`, `openFile` from `@/lib/api` (base `/api/v1`, auth + refresh handled). Errors are `ApiError` (`message`, `code`, `fieldErrors`). |
| List state in URL | `useListParams(defaults)` → `{ params, query, set, clear, hasFilters }` |
| Tables | `DataTable` (`@/components/tables/data-table`): server pagination/sorting, column visibility (`storageKey`), loading/empty/error states, `bulkActions`, `toolbar` |
| Simple CRUD resources | `MasterDataPage` (`@/components/common/master-data-page`) — config-driven list + drawer form + archive |
| Controls | `SearchInput` (debounced), `FilterBar`, `Combobox`, `EmployeePicker`, `FileUpload` (`@/components/common/controls`); `Input`, `Textarea`, `Select`, `Checkbox`, `Switch`, `DatePicker`, `DateRangePicker` (`@/components/ui/input`) |
| Layout/display | `PageHeader`, `Card`, `CardHeader`, `CardBody`, `StatCard`, `Badge`, `Avatar` (loads protected images), `PersonCell`, `DescriptionList`, `ProgressBar`, `EmptyState`, `ErrorState`, `Skeleton`, `PageSkeleton` (`@/components/ui/display`) |
| Overlays | `Modal`, `Drawer`, `Tabs`, `Dropdown`, `Tooltip`, `useConfirm()` (destructive actions; supports `requireReason` for rejections) (`@/components/ui/overlay`) |
| Status colors | `StatusBadge` / `statusTone` (`@/components/common/status-badge`) |
| Forms | RHF + `zodResolver(schemaFromShared)`; `FormField` (label/error/ARIA), `FormError`, `FormGrid`, `FormSection`, `applyServerErrors(apiError, setError)` (`@/components/forms/form`) |
| Permissions | `usePermissions()` → `can`, `canAny`, `isManager`, `hasEmployee`, `user`; route guard `<RequirePermission any={[...]} manager employee>` |
| Formatting | `formatDate` (calendar dates, UTC-safe), `formatDateTime`, `formatTime`, `timeAgo`, `formatMoney(amount, currency)`, `minutesToHours`, `fullName`, `toDateKey`, `apiDateKey` (`@/lib/utils`); enum labels via `label()` (`@/lib/i18n`) |
| Toasts | `toast.success/error` from `sonner` (mutation errors are toasted globally unless `meta: { silent: true }` — use silent for forms that show inline errors) |
| Charts | `recharts` inside `ResponsiveContainer`; use CSS variable colors (`var(--color-brand-600)`, `var(--muted)`, `var(--line)`) so dark mode works |

## Rules

- Every page handles loading (skeleton), error (`ErrorState` with retry) and empty (`EmptyState` with a helpful action) states.
- Buttons perform real API calls; lists/filters/sorting are server-side; never fake data.
- Destructive or irreversible actions (delete, archive, reject, cancel, pay, deactivate) go through `useConfirm()`.
- Forms: validation via shared Zod schemas, disabled/loading submit (`loading={formState.isSubmitting}`), server field errors mapped with `applyServerErrors`, success toast.
- Hide actions the user can't perform (`can(...)`), but never rely on that for security — the API enforces permissions.
- Mobile first: layouts must work at 360px wide (stack filters, `overflow-x-auto` tables, full-width buttons on small screens).
- Accessibility: labels for every control, `aria-label` on icon-only buttons, keyboard-operable custom widgets.
- Money: always `formatMoney(value, user.organization.currency)` (or the record's currency).
- Dates from the API that represent calendar days (leave dates, holidays, attendance `date`) are 00:00 UTC — format with `formatDate`, send as `YYYY-MM-DD`.
- No `any`. Keep query keys namespaced: `['<resource>', ...]`, and invalidate the namespace after mutations.

## Commands

- Typecheck: `corepack pnpm --filter @stencil/web typecheck`
- Build: `corepack pnpm --filter @stencil/web build`
- Never run `npm install`; dependencies are managed by pnpm with the store on C: (the repo drive is tiny).
