// The Admin tab: one place for this phone's staff logins, with a sub-tab per role.
//   Choir (choir admin): programme, scores, library, people        (#/choiradmin)
//   Sections (section lead or admin): progress, hard bars, ranges  (#/choirinsights, #/section)
//   Choirs (super admin): the choir list, new choirs, purge         (#/superadmin)
//   Usage (super admin): anonymous usage statistics                (#/usage)
// The bottom tab shows only with a staff login (members and solo singers never see it); the server
// checks every request anyway. Opened by address without that login, a sub-tab shows its login form.

import React, { useEffect } from 'react';
import { back, go, type Route } from '../router';
import { useProfile } from '../hooks';
import { IconBack } from '../icons';
import { refreshSuperSessionSoon, staffRoles, type AdminTab, type Staff } from '../../progress/choir';
import { ChoirAdmin, SectionLead, SuperAdmin, useSession } from './Choir';
import { ChoirInsights } from './InsightsChoir';
import { UsageInsights } from './InsightsUsage';

export type AdminRouteName = 'choiradmin' | 'section' | 'choirinsights' | 'superadmin' | 'usage';
export const ADMIN_ROUTES: readonly string[] = ['choiradmin', 'section', 'choirinsights', 'superadmin', 'usage'];

export function adminTabOf(name: string): AdminTab | null {
  switch (name) {
    case 'choiradmin': return 'choir';
    case 'section':
    case 'choirinsights': return 'sections';
    case 'superadmin': return 'choirs';
    case 'usage': return 'usage';
    default: return null;
  }
}

/** Where a sub-tab lives: an admin's Sections start with every section side by side, a lead's with their own. */
export function adminRoute(tab: AdminTab, staff: Staff): Route {
  switch (tab) {
    case 'choir': return { name: 'choiradmin' };
    case 'sections': return { name: staff.admin ? 'choirinsights' : 'section' };
    case 'choirs': return { name: 'superadmin' };
    case 'usage': return { name: 'usage' };
  }
}

const LAST_TAB = 'schonberg:adminTab';
function lastTab(): AdminTab | null {
  try {
    const v = localStorage.getItem(LAST_TAB);
    return v === 'choir' || v === 'sections' || v === 'choirs' || v === 'usage' ? v : null;
  } catch {
    return null;
  }
}
function rememberTab(t: AdminTab): void {
  try { localStorage.setItem(LAST_TAB, t); } catch { /* storage blocked: start on the first sub-tab */ }
}

/** The bottom tab opens the sub-tab used last (if this phone's logins still allow it). */
export function adminHome(staff: Staff): Route {
  const t = lastTab();
  return adminRoute(t && staff.tabs.includes(t) ? t : staff.tabs[0] ?? 'choir', staff);
}

/** This phone's staff logins (re-renders when a login starts or ends, or the choir changes). */
export function useStaff(): Staff {
  const [profile] = useProfile();
  useSession();
  return staffRoles(profile.choirCode);
}

const LABEL: Record<AdminTab, string> = { choir: 'Choir', sections: 'Sections', choirs: 'Choirs', usage: 'Usage' };
// Titles when a sub-tab is opened by address without its login (e.g. #/superadmin to log in).
const TITLE: Record<AdminTab, string> = { choir: 'Choir admin', sections: 'Sections', choirs: 'Super admin', usage: 'Usage insights' };

export function AdminScreen({ route }: { route: Route }) {
  const staff = useStaff();
  const tab = adminTabOf(route.name) ?? 'choir';
  const allowed = staff.tabs.includes(tab);
  useEffect(() => { if (allowed) rememberTab(tab); }, [allowed, tab]);
  // A super-admin login the server ended (expired, the password changed) shows as such on opening.
  useEffect(() => { refreshSuperSessionSoon(); }, [tab]);
  const body = tab === 'choir' ? <ChoirAdmin />
    : tab === 'sections' ? (route.name === 'section' || (!staff.admin && staff.lead) ? <SectionLead /> : <ChoirInsights />)
    : tab === 'choirs' ? <SuperAdmin />
    : <UsageInsights />;
  return (
    <main className="screen wide admin" data-testid="admin-screen">
      <div className="topbar">
        {!allowed && <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'settings' })}><IconBack /></button>}
        <h1>{allowed && staff.label ? staff.label : TITLE[tab]}</h1>
      </div>
      {staff.tabs.length > 1 && (
        <div className="seg admin-tabs" role="group" aria-label="Admin sections" data-testid="admin-tabs">
          {staff.tabs.map((t) => (
            <button key={t} aria-pressed={t === tab} data-testid={`admin-tab-${t}`} onClick={() => { if (t !== tab || route.name === 'section') go(adminRoute(t, staff)); }}>
              {LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <div className="lay admin-body">{body}</div>
    </main>
  );
}
