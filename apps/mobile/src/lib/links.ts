import type { Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { webUrl } from './config';

const OBJECT_ID = '([a-f\\d]{24})';
const match = (path: string, pattern: string) => new RegExp(`^${pattern}/?$`, 'i').exec(path)?.[1];
const isId = (v: string | undefined): v is string => !!v && /^[a-f\d]{24}$/i.test(v);

/** Modules that only exist on the web: their links open the web app in the browser. */
const WEB_ONLY = ['/performance', '/recruitment', '/onboarding', '/offboarding', '/payroll', '/reports', '/admin'];

export type LinkTarget = { kind: 'route'; href: Href } | { kind: 'web'; url: string };

export interface LinkContext {
  /**
   * The link comes from an "awaiting your approval" notification and the user can approve:
   * expense and attendance-correction links open the Approvals screens instead of the owner's view.
   */
  approval?: boolean;
}

const parse = (link: string) => {
  const relative = link.trim().replace(/^https?:\/\/[^/]+/i, '');
  const [pathAndQuery = ''] = relative.split('#');
  const [path = '', queryString = ''] = pathAndQuery.split('?');
  const query = new Map<string, string>();
  for (const pair of queryString.split('&')) {
    if (!pair) continue;
    const [k = '', v = ''] = pair.split('=');
    try {
      query.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' ')));
    } catch {
      /* malformed escape: ignore the parameter */
    }
  }
  return { path: path.replace(/\/+$/, '') || '/', query, relative: pathAndQuery };
};

const route = (href: Href): LinkTarget => ({ kind: 'route', href });

/*
 * Leave and Approvals detail screens are owned by their own features; their
 * paths are built as strings so this map does not depend on those files existing.
 */
const leaveRequest = (id: string) => route(`/leave/${id}` as Href);
const approvalExpense = (id: string) => route(`/approvals/expense/${id}` as Href);
const approvalRegularization = (id: string) => route(`/approvals/regularization/${id}` as Href);

/**
 * Resolves a web route carried by notifications (`data.link`, e.g.
 * `/leave/requests/<id>`) to the app screen that shows it, or to the web app
 * for web-only modules. Unknown links open the notifications screen; `null`
 * means there is nothing to open.
 */
export const resolveLink = (link: string | null | undefined, ctx: LinkContext = {}): LinkTarget | null => {
  if (!link) return null;
  const { path, query, relative } = parse(link);
  if (!path.startsWith('/')) return null;
  const starts = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  let id: string | undefined;

  // Web-only modules.
  if (WEB_ONLY.some(starts)) return { kind: 'web', url: webUrl(relative) };

  // Home.
  if (path === '/' || starts('/dashboard')) return route('/');

  // Attendance & corrections.
  if ((id = match(path, `/attendance/regularizations/${OBJECT_ID}`))) {
    return ctx.approval ? approvalRegularization(id) : route({ pathname: '/attendance/regularizations/[id]', params: { id } });
  }
  if (starts('/regularization')) {
    const requestId = query.get('request');
    if (isId(requestId)) return approvalRegularization(requestId);
    return route(ctx.approval ? '/approvals' : '/attendance/regularizations');
  }
  if (starts('/attendance/regularizations')) return route('/attendance/regularizations');
  if (starts('/attendance')) return route('/attendance');

  // Leave & approvals.
  if ((id = match(path, `/leave/requests/${OBJECT_ID}`))) return leaveRequest(id);
  if (starts('/leave/approvals') || starts('/approvals')) return route('/approvals');
  if (starts('/leave')) return route('/leave');

  // Payslips.
  if ((id = match(path, `/payslips/${OBJECT_ID}`))) return route({ pathname: '/more/payslips/[id]', params: { id } });
  if (starts('/payslips')) return route('/more/payslips');

  // Expenses.
  if (starts('/expenses/approvals')) return route('/approvals');
  if ((id = match(path, `/expenses/${OBJECT_ID}`))) {
    return ctx.approval ? approvalExpense(id) : route({ pathname: '/more/expenses/[id]', params: { id } });
  }
  if (starts('/expenses')) return route('/more/expenses');

  // Communication.
  if ((id = match(path, `/announcements/${OBJECT_ID}`))) return route({ pathname: '/more/announcements/[id]', params: { id } });
  if (starts('/announcements')) return route('/more/announcements');
  if (starts('/notifications')) return route('/more/notifications');

  // Emergency alerts (HR).
  if (starts('/emergencies')) return route('/more/emergencies');

  // Tasks (`/tasks?id=<task>` highlights the task).
  if (starts('/tasks')) {
    const taskId = query.get('id');
    return route(isId(taskId) ? { pathname: '/more/tasks', params: { id: taskId } } : '/more/tasks');
  }

  // Documents, assets, people.
  if (starts('/documents')) {
    const highlight = query.get('highlight');
    return route(isId(highlight) ? { pathname: '/more/documents', params: { highlight } } : '/more/documents');
  }
  if (starts('/assets')) return route('/more/assets');
  if (starts('/profile') || starts('/me')) return route('/more/profile');
  if ((id = match(path, `/employees/${OBJECT_ID}`))) return route({ pathname: '/more/team/[id]', params: { id } });
  if (starts('/employees') || starts('/team')) return route('/more/team');
  if (starts('/settings')) return route('/more/settings');

  return route('/more/notifications');
};

/** Opens a web-app URL in the in-app browser (Custom Tabs / SFSafariViewController). */
export const openWebApp = (url: string) =>
  WebBrowser.openBrowserAsync(url).catch((err: unknown) => {
    console.warn('[links] could not open the browser', err);
  });

/**
 * App route for a notification link (used by push-notification taps).
 * Links to web-only modules are opened in the browser and return `null`.
 */
export const hrefForLink = (link: string | null | undefined, ctx?: LinkContext): Href | null => {
  const target = resolveLink(link, ctx);
  if (!target) return null;
  if (target.kind === 'web') {
    void openWebApp(target.url);
    return null;
  }
  return target.href;
};
