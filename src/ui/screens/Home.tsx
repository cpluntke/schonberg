import React from 'react';
import { allPieces, getPiece, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, formatDate, daysUntil, initials } from '../hooks';
import { go } from '../router';
import { loadCycle, streakDays, sameWork } from '../../progress/store';
import { levelLabel, levelSpec, stepLabel } from '../../progress/ladder';
import { nextRehearsal } from '../../progress/rehearsal';
import { rowOfTheDay } from '../../game/twelvetone';
import { IconFlame, IconPlay, IconMic, IconStar } from '../icons';
import { cyclePoints, practisedToday } from '../../progress/points';
import { IntroVideoButton } from '../components/IntroVideo';
import { apiBase, cachedChoir, choirCycleNext, choirCycleNow, choirLogo, loadSession, sharingNeedsOk, startSharing } from '../../progress/choir';
import { shareMyProgress } from '../play/shareProgress';
import { LoggedOutCard, SyncNotice } from '../components/AccountSync';
import { pieceStatus, todaysPlan, type PieceStatus } from '../plan';
import { presenceShown, usePresence } from '../../progress/presence';
import { LOGO_TILE } from '../components/ChoirLogo';
import { useStaff } from './Admin';
import { labEnabled } from './IntonationLab';
import { labInProgramme, loadLab, RUNGS } from '../../game/intonation';

export { pieceStatus, type PieceStatus };

function pcSym(p: number) { return p === 10 ? 't' : p === 11 ? 'e' : String(p); }

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export function Home() {
  const [profile] = useProfile();
  useStoreVersion();
  const cycle = loadCycle();
  const cyclePieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const statuses = cyclePieces.map((p) => pieceStatus(p, profile.voice));
  const streak = streakDays();
  const today = practisedToday();
  const points = cyclePoints();
  const choir = profile.choirCode ? cachedChoir() : null;
  const logo = choir ? choirLogo() : null;
  const betweenCycles = !!choir && choir.code === profile.choirCode && Array.isArray(choir.cycles) && !choirCycleNow(choir);
  const nextCycle = betweenCycles ? choirCycleNext(choir) : null;
  const focusIds = new Set(cycle.focusPieceIds ?? []);
  const plan = todaysPlan(statuses, cycle);
  const focus = plan[0] ?? null;
  const row = rowOfTheDay(new Date());
  const staff = useStaff();
  const nr = nextRehearsal(cycle);
  const toRehearsal = nr ? nr.days : null;
  const toConcert = daysUntil(cycle.concertDate);
  const focusStatuses = statuses.filter((s) => focusIds.has(s.piece.id));
  const focusMissing = (cycle.wanted ?? []).filter((w) => w.focus && !statuses.some((s) => sameWork(s.piece.title, w.title)));
  const target = cycleTarget(statuses, toRehearsal, toConcert, focusStatuses.length ? focusStatuses : null);
  const avg = statuses.length ? statuses.reduce((a, s) => a + s.pct, 0) / statuses.length : 0;
  const noDates = !nr && !cycle.concertDate;
  // The concert is over: what comes next (the choir's next programme, or the singer's own dates).
  const fromChoir = !!profile.choirCode || !!cycle.preset?.startsWith('choir:');
  const concertOver = toConcert != null && toConcert < 0;

  return (
    <main className="screen wide home">
      <div className="lay home-top">
      <div className="row between home-head">
        <div className="row home-brand" style={{ gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Schönberg</span>
          <span className="badge">Hero</span>
        </div>
        <button className="icon-btn filled" aria-label="Voice setup" onClick={() => go({ name: 'setup' })}
          style={{ border: '2px solid var(--voice)', fontWeight: 700, fontSize: 14 }}>
          {profile.name ? initials(profile.name) : profile.voice}
        </button>
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
          <h1 className="hero">{greeting()}{profile.name ? `, ${profile.name.split(' ')[0]}` : ''}</h1>
          <span className="small muted">{voiceName(profile.voice)}{logo && choir?.name ? ` · ${choir.name}` : ''}</span>
        </div>
        {logo && (
          <img src={logo} alt={`${choir?.name ?? 'Choir'} logo`} data-testid="choir-logo" className="home-logo"
            style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'contain', background: LOGO_TILE, padding: 4, boxSizing: 'border-box', flex: 'none' }} />
        )}
      </div>
      </div>

      {/* Wide screens: today in the main column, the repertoire beside it. */}
      <div className="lay home-cols">
      <div className="lay home-main">

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }} data-testid="stats">
        <div className="card flat" style={{ gap: 2, padding: '12px 14px', minWidth: 0 }} data-testid="streak-tile">
          <div className="row" style={{ gap: 6 }}>
            <IconFlame size={26} color={streak > 0 && !today ? '#8A6A5C' : '#FF7A45'} />
            <span className="mono" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }} data-testid="streak-days">{streak}</span>
          </div>
          <span className="small" style={{ fontWeight: 700 }}>day streak</span>
          <span className="tiny muted">{today ? 'Practised today ✓' : streak > 0 ? 'Sing today to keep it going' : 'Sing today to start one'}</span>
        </div>
        <div className="card flat" style={{ gap: 2, padding: '12px 14px', minWidth: 0 }} data-testid="points-tile">
          <div className="row" style={{ gap: 6 }}>
            <IconStar size={24} color="#4CC9F0" />
            <span className="mono" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }} data-testid="cycle-points">{points.n.toLocaleString()}</span>
          </div>
          <span className="small" style={{ fontWeight: 700 }}>notes right this cycle</span>
          {points.name && <span className="tiny muted">{points.name}</span>}
        </div>
      </div>

      <PractisingNow />

      <Notice />
      <SyncNotice />
      <LoggedOutCard />
      {sharingNeedsOk() && (
        <div className="card" data-testid="share-ask" style={{ gap: 8 }}>
          <span className="small">Your choir now shares everyone's practice with the section leads: which bars are hard for the section (as totals) and your voice range. Yours isn't shared yet.</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary small" onClick={() => { startSharing(); void shareMyProgress(true); }}>Start sharing</button>
            <button className="btn small ghost" onClick={() => go({ name: 'choir' })}>What's shared</button>
          </div>
        </div>
      )}

      {!profile.onboarded && (
        <div className="card" style={{ borderColor: 'var(--voice-deep)' }}>
          <div className="row">
            <IconMic color="#4CC9F0" />
            <div className="grow col" style={{ gap: 2 }}>
              <strong>Set up your voice (2 min)</strong>
              <span className="small muted">Mic check, your range, headphone delay and your preferred note names.</span>
            </div>
          </div>
          <IntroVideoButton className="btn block" />
          <button className="btn primary block" data-testid="home-setup" onClick={() => go({ name: 'setup' })}>Start setup</button>
          {apiBase() && !loadSession() && ( // (logged in already: nothing to get back)
            <button className="linklike small muted" style={{ alignSelf: 'center', minHeight: 40 }} data-testid="home-account"
              onClick={() => { try { sessionStorage.setItem('sh:openAccount', 'login'); } catch { /* ignore */ } go({ name: 'settings' }); }}>New phone? Log in to your choir account to get your progress back</button>
          )}
        </div>
      )}

      {betweenCycles && (
        <div className="notice info small" data-testid="between-cycles">
          {nextCycle
            ? <><strong>{choir?.name ?? 'Your choir'}: the last cycle is over.</strong> Next: {nextCycle.name}, from {formatDate(nextCycle.start)}.</>
            : <><strong>{choir?.name ?? 'Your choir'}: the last cycle is over.</strong> The next programme comes when your choir starts a new cycle.</>}
        </div>
      )}

      {/* (between the choir's cycles the notice above stands for the cycle: no dates to set; the
          singer's own pieces still get today's practice) */}
      {(!betweenCycles || !!focus?.next) && <section className="card" data-testid="cycle-card">
        {!betweenCycles && <>
          <div className="row between">
            <div className="eyebrow">{cycle.name || 'This cycle'}</div>
            <button className="btn ghost small" onClick={() => go({ name: 'settings' })}>{noDates ? 'Set dates' : 'Edit dates'}</button>
          </div>
          <div className="row" style={{ gap: 16 }}>
            <Countdown label="Rehearsal" days={toRehearsal} date={nr?.label} raw />
            <Countdown label="Concert" days={toConcert} date={cycle.concertDate} />
            <div className="col" style={{ gap: 2, marginLeft: 'auto', alignItems: 'flex-end' }}>
              <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{Math.round(avg * 100)}%</span>
              <span className="tiny muted">cycle readiness</span>
            </div>
          </div>
        </>}
        {!betweenCycles && focusStatuses.length + focusMissing.length > 0 && nr && nr.days >= 0 && (
          <div className="small" data-testid="rehearsal-focus">
            <span className="muted">{nr.days === 0 ? 'Tonight' : `Next rehearsal (${nr.label})`}:</span>{' '}
            {focusStatuses.map((s, i) => (
              <span key={s.piece.id}>{i ? ', ' : ''}<button className="linklike" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>{s.piece.title}</button>
                <span className="muted"> {Math.round(s.pct * 100)}%</span></span>
            ))}
            {focusMissing.map((w, i) => (
              <span key={w.title}>{i || focusStatuses.length ? ', ' : ''}<button className="linklike" onClick={() => go({ name: 'library' })}>{w.title}</button>
                <span className="muted"> (import first)</span></span>
            ))}
          </div>
        )}
        {!betweenCycles && concertOver && (
          <div className="notice info small col" style={{ gap: 8 }} data-testid="concert-over">
            <span>{fromChoir
              ? 'The concert is over. Your choir will publish the next programme here; until then, keep your pieces fresh.'
              : 'The concert is over. Set the dates of your next rehearsal and concert to plan the next cycle.'}</span>
            {!fromChoir && <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => go({ name: 'settings' })}>Set new dates</button>}
          </div>
        )}
        {!betweenCycles && target && <div className="small" style={{ color: 'var(--accent-text)' }}>{target}</div>}
        {focus && focus.next ? (
          <>
            <NextUp status={focus} secondary={!profile.onboarded} />
            {plan.length > 1 && (
              <div className="col" style={{ gap: 0 }}>
                <span className="tiny muted">Also today</span>
                {plan.slice(1).map((st) => (
                  <button key={st.piece.id} className="list-row" style={{ padding: '8px 0' }}
                    onClick={() => go({ name: 'play', pieceId: st.piece.id, partId: st.partId, sectionId: st.next!.sectionId, level: st.next!.level, step: st.next!.step, mode: '2d' })}>
                    <IconPlay size={14} color="#FF7A45" />
                    <span className="grow small ellipsis"><strong>{st.piece.title}</strong> · {st.next!.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : statuses.length ? (
          <div className="notice info">Everything in this cycle is concert-ready. Try the arcade mode or today's Zwölfton row.</div>
        ) : (
          <div className="notice info">{labInProgramme()
            ? 'No scores in this cycle yet. Start with the intonation lab below.'
            : "No pieces in this cycle yet. Add some from the Library or import your choir's MusicXML."}</div>
        )}
      </section>}

      {labInProgramme() && <IntonationCard inProgramme />}
      </div>

      <div className="lay home-side">
      <section className="col home-rep" style={{ gap: 2 }}>
        <div className="row between">
          <h2>Repertoire</h2>
          <button className="btn ghost small" onClick={() => go({ name: 'library' })}>Library</button>
        </div>
        {statuses.map((s) => (
          <button key={s.piece.id} className="list-row" data-testid="piece-row" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>
            <div className="mono-tile">{initials(s.piece.composer || s.piece.title)}</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{s.piece.title}</span>
              <span className="small muted ellipsis">
                {[s.piece.composer, s.partName].filter(Boolean).join(' · ')}
                {s.next?.kind === 'fix' ? ` · ${s.toFix.reduce((n, f) => n + f.sectionIds.length, 0)} to fix` : s.fullDue ? ' · full run due for review' : s.due.length ? ` · ${s.due.length} due for review` : ''}
              </span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span className="mono small">{Math.round(s.pct * 100)}%</span>
              <span className="tiny muted" data-testid="piece-row-level">{pieceLabel(s)}</span>
            </div>
          </button>
        ))}
        {(cycle.wanted ?? []).filter((w) => !statuses.some((s) => sameWork(s.piece.title, w.title))).map((w) => (
          <button key={w.title} className="list-row" onClick={() => go({ name: 'library' })} data-testid="wanted-row">
            <div className="mono-tile" style={{ color: 'var(--muted)', border: '1px dashed var(--line)', background: 'transparent' }}>+</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{w.title}</span>
              <span className="small muted ellipsis">{[w.composer, w.note ?? 'import your choir’s score'].filter(Boolean).join(' · ')}</span>
            </div>
            <span className="badge muted">Import</span>
          </button>
        ))}
      </section>

      {labEnabled(staff) && !labInProgramme() && <IntonationCard />}

      <button className="card expert" style={{ textAlign: 'left', color: 'inherit' }} onClick={() => go({ name: 'expert' })}>
        <div className="row between">
          <strong>Zwölfton of the day</strong>
          <span className="badge expert">Expert</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0,1fr))', gap: 3 }}>
          {row.map((pc, i) => (
            <span key={i} className="mono" style={{ height: 26, borderRadius: 6, background: '#262257', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#D4CCFF' }}>{pcSym(pc)}</span>
          ))}
        </div>
        <span className="small" style={{ color: '#D4CCFF' }}>Plus leap drills built from the hardest intervals in your parts.</span>
      </button>
      </div>
      </div>
    </main>
  );
}

function Notice() {
  const [msg, setMsg] = React.useState(() => { try { return localStorage.getItem('sh:notice'); } catch { return null; } });
  if (!msg) return null;
  return (
    <div className="notice info row" role="status">
      <span className="grow small">{msg}</span>
      <button className="btn ghost small" onClick={() => { try { localStorage.removeItem('sh:notice'); } catch { /* blocked */ } setMsg(null); }}>OK</button>
    </div>
  );
}

/** The intonation lab: in the programme (all singers) or as a preview (admins, see labEnabled). */
function IntonationCard({ inProgramme = false }: { inProgramme?: boolean }) {
  const lab = loadLab();
  const step = (k: 'fifth' | 'third') => (lab[k].rung > RUNGS ? 'done ✓' : `step ${lab[k].rung} of ${RUNGS}`);
  return (
    <button className="card" style={{ textAlign: 'left', color: 'inherit', borderColor: 'var(--voice-deep)' }} data-testid="home-intonation"
      onClick={() => go({ name: 'intonation' })}>
      <div className="row between">
        <strong>Intonation lab</strong>
        <span className="badge">{inProgramme ? 'In this cycle' : 'Preview · admins'}</span>
      </div>
      <span className="small muted">Find the pure fifth and the pure major third by ear: listen, tune by hand, then sing.</span>
      <span className="tiny mono" style={{ color: 'var(--voice)' }}>Fifth: {step('fifth')} · Third: {step('third')}</span>
    </button>
  );
}

/** Short status for a piece row: its piece level, or what's in progress. */
export function pieceLabel(s: PieceStatus): string {
  if (s.memorised) return 'memorised';
  if (s.concertReady) return 'concert-ready';
  if (s.rehearsalReady) return 'rehearsal-ready';
  if (s.pieceLevel > 0) return levelLabel(s.pieceLevel);
  if (s.toFix.length) return 'passages to fix';
  if (s.multi && s.unconfirmed > 0) return `confirm Level ${s.unconfirmed}`;
  return s.pct > 0 ? 'in progress' : 'not started';
}

/** `secondary`: before the voice setup, setup is the one primary action and practising comes second. */
function NextUp({ status, secondary }: { status: PieceStatus; secondary?: boolean }) {
  const n = status.next!;
  const spec = levelSpec(n.level);
  // An experienced singer can skip the sections: offer the full run at the next piece level.
  const skip = status.multi && n.kind === 'section' && status.pieceLevel < 5 ? status.pieceLevel + 1 : 0;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="col" style={{ gap: 2 }}>
        <span className="small muted">Next up</span>
        <span style={{ fontSize: 20, fontWeight: 800 }}>{status.piece.title}</span>
        <span className="small muted">{n.reason}{spec && !n.reason.includes(spec.name) ? ` (${stepLabel(n.level, n.step)})` : ''}</span>
      </div>
      <button className={`btn block${secondary ? '' : ' primary'}`} onClick={() => go({ name: 'play', pieceId: status.piece.id, partId: status.partId, sectionId: n.sectionId, level: n.level, step: n.step, mode: '2d' })}>
        <IconPlay size={18} {...(secondary ? { color: '#FF7A45' } : {})} /> {n.sectionId === 'all' ? 'Sing it all now' : n.kind === 'fix' ? 'Fix it now' : 'Practise now'}
      </button>
      {skip > 0 && (
        <button className="btn ghost small" data-testid="skip-to-full" onClick={() => go({ name: 'play', pieceId: status.piece.id, partId: status.partId, sectionId: 'all', level: skip, step: 'tempo', mode: '2d' })}>
          Know it already? Sing the whole piece at Level {skip}
        </button>
      )}
    </div>
  );
}

export { sameWork };

function Countdown({ label, days, date, raw }: { label: string; days: number | null; date?: string; raw?: boolean }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
        {days == null ? '–' : days < 0 ? 'past' : days === 0 ? 'today' : `${days}d`}
      </span>
      <span className="tiny muted">{label}{date ? ` · ${raw ? date : formatDate(date)}` : ' · not set'}</span>
    </div>
  );
}

function cycleTarget(statuses: PieceStatus[], toRehearsal: number | null, toConcert: number | null, focus: PieceStatus[] | null): string | null {
  const goals = [
    { label: 'Rehearsal', level: 3, days: toRehearsal, name: levelLabel(3), set: focus ?? statuses },
    { label: 'Concert', level: 4, days: toConcert, name: levelLabel(4), set: statuses },
  ];
  for (const g of goals) {
    if (g.days == null || g.days < 0) continue;
    // The piece level counts: a piece is ready once it has been sung through at the level.
    const missing = g.set.filter((st) => st.pieceLevel < g.level).length;
    if (!missing) continue;
    const when = g.days === 0 ? 'today' : g.days === 1 ? 'tomorrow' : `in ${g.days} days`;
    const what = g.label === 'Rehearsal' && focus
      ? `${missing === g.set.length && missing > 1 ? 'the' : missing} rehearsal piece${missing > 1 ? 's' : ''}`
      : `${missing} piece${missing > 1 ? 's' : ''}`;
    const perDay = g.days > 1 && missing > 1 ? Math.ceil(missing / g.days) : 0;
    return `${g.label} ${when}: ${what} not yet sung through at ${g.name}${perDay && perDay < missing ? `, about ${perDay} a day` : ''}.`;
  }
  return null;
}

export function voiceName(v: string): string {
  return ({ S: 'Soprano', A: 'Alto', T: 'Tenor', B: 'Bass' } as Record<string, string>)[v] ?? 'Singer';
}

export function levelName(l: number): string {
  if (l <= 0) return 'not started';
  return levelSpec(l)?.name ?? `Level ${l}`;
}

export { allPieces };

const VOICE_WORD: Record<'S' | 'A' | 'T' | 'B', [string, string]> = {
  S: ['soprano', 'sopranos'], A: ['alto', 'altos'], T: ['tenor', 'tenors'], B: ['bass', 'basses'],
};

/** How many others in the choir have the singing screen open right now, per voice part (live, no names). */
function PractisingNow() {
  const counts = usePresence();
  if (!presenceShown()) return null;
  // (the row keeps its height until the first answer, so the cards below don't jump)
  if (!counts) return <div className="small" style={{ minHeight: 20 }} data-testid="practising-now-wait" aria-hidden />;
  const total = counts.S + counts.A + counts.T + counts.B;
  const label = total
    ? `Practising now: ${(['S', 'A', 'T', 'B'] as const).filter((v) => counts[v]).map((v) => `${counts[v]} ${VOICE_WORD[v][counts[v] === 1 ? 0 : 1]}`).join(', ')}`
    : 'Nobody else is practising right now';
  return (
    <div className="row small" style={{ gap: 8, flexWrap: 'wrap', color: 'var(--muted)', minHeight: 20 }} data-testid="practising-now" aria-label={label} role="status">
      <span className={total ? 'live-dot on' : 'live-dot'} aria-hidden />
      <span>Practising now</span>
      {!total && <span>· nobody else right now</span>}
      {!!total && (['S', 'A', 'T', 'B'] as const).map((v) => (
        <span key={v} className="mono" style={{ opacity: counts[v] ? 1 : 0.65 }} data-testid={`practising-${v}`}>
          {v} <strong key={counts[v]} className="pop" style={{ color: counts[v] ? 'var(--text)' : undefined }}>{counts[v]}</strong>
        </span>
      ))}
    </div>
  );
}
