import React from 'react';
import { allPieces, getPiece, singableSections, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, useDay, formatDate, daysUntil, initials } from '../hooks';
import { go, openAt } from '../router';
import { getProgress, loadCycle, practiceDays, sameWork } from '../../progress/store';
import { levelLabel, levelSpec, stepWord } from '../../progress/ladder';
import { nextRehearsal } from '../../progress/rehearsal';
import { IconMic } from '../icons';
import { IntroVideoButton } from '../components/IntroVideo';
import { YouButton } from '../components/YouSheet';
import { meterNodes, pathStatus } from '../path';
import { LevelMeter } from '../components/LevelMeter';
import { PlanCard, RehearsalCheck, StatusLine, TodayDone, WeekCard } from '../components/Today';
import { computeToday, dateWords, endSession, lastRehearsal } from '../today';
import { saveToday } from '../../progress/today';
import { apiBase, cachedChoir, choirCycleNext, choirCycleNow, choirLogo, loadSession, sharingNeedsOk, startSharing } from '../../progress/choir';
import { shareMyProgress } from '../play/shareProgress';
import { LoggedOutCard, SyncNotice, openAccount } from '../components/AccountSync';
import { pieceStatus, type PieceStatus } from '../plan';
import { presenceShown, usePresence } from '../../progress/presence';
import { LOGO_TILE } from '../components/ChoirLogo';
import { useStaff } from './Admin';
import { labEnabled } from './IntonationLab';
import { labInProgramme, loadLab, RUNGS } from '../../game/intonation';

export { pieceStatus, type PieceStatus };


export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export function Home() {
  const [profile] = useProfile();
  const version = useStoreVersion();
  const day = useDay();
  const staff = useStaff();
  const labOn = labEnabled(staff);
  // Today: the plan (frozen once started), and whether it's done; planned once per change of the store
  // or the day, and stored after rendering (Home never writes while it draws).
  const today = React.useMemo(() => computeToday(labOn), [version, day, labOn]);
  React.useEffect(() => { if (today.save) saveToday({ ...today.save, session: null }, false); }, [today]);
  // Back on Home: today's session pauses (the strip shows again once a step is started from here).
  React.useEffect(() => { endSession(); }, []);
  const cycle = loadCycle();
  const cyclePieces = cycle.pieceIds.map((id) => getPiece(id)).filter(Boolean) as PieceInfo[];
  const statuses = cyclePieces.map((p) => pieceStatus(p, profile.voice));
  const choir = profile.choirCode ? cachedChoir() : null;
  const logo = choir ? choirLogo() : null;
  const betweenCycles = !!choir && choir.code === profile.choirCode && Array.isArray(choir.cycles) && !choirCycleNow(choir);
  const nextCycle = betweenCycles ? choirCycleNext(choir) : null;
  const nr = nextRehearsal(cycle);
  const toConcert = daysUntil(cycle.concertDate);
  const focusMissing = (cycle.wanted ?? []).filter((w) => w.focus && !statuses.some((s) => sameWork(s.piece.title, w.title)));
  // The concert is over: what comes next (the choir's next programme, or the singer's own dates).
  const fromChoir = !!profile.choirCode || !!cycle.preset?.startsWith('choir:');
  const concertOver = toConcert != null && toConcert < 0;
  const { plan, status } = today;
  const done = profile.onboarded && plan.steps.length > 0 && (status.complete || !!today.finished);
  const everPractised = practiceDays(1).length > 0;
  const first = profile.name ? profile.name.split(' ')[0] : '';
  const hello = done ? 'Gut gemacht' : plan.mode === 'welcome' ? 'Welcome back' : greeting();
  const rehearsalTime = plan.mode === 'rehearsal' && cycle.rehearsalWeekday != null ? (cycle.rehearsalTime ?? '19:30') : undefined;
  const afterRehearsal = !!lastRehearsal(day, cycle);
  // (only a rehearsal still ahead: a one-off date that has passed isn't the next one)
  const nextLabel = nr && nr.days >= 0 && !nr.over ? (nr.days === 0 ? 'tonight' : dateWords(nr.at)
    + (cycle.rehearsalWeekday != null ? ` ${cycle.rehearsalTime ?? '19:30'}` : '')) : undefined;

  return (
    <main className="screen wide home">
      <div className="lay home-top">
      <div className="row between home-head">
        <div className="row home-brand" style={{ gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Schönberg</span>
          <span className="badge">Hero</span>
        </div>
        <YouButton />
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
          <h1 className="hero" data-testid="greeting">{hello}{first ? `, ${first}` : ''}</h1>
          <span className="t14 muted">{voiceName(profile.voice)}{logo && choir?.name ? ` · ${choir.name}` : ''}</span>
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

      {!profile.onboarded && (
        <div className="card first-open" style={{ borderColor: 'var(--voice-deep)' }} data-testid="first-open">
          <strong className="first-line">Learn your part and sing it in tune before the next rehearsal.</strong>
          <span className="t14 muted">The app listens while you sing your own voice part and shows you the one note to fix. 10–15 minutes a day is enough.</span>
          <div className="row">
            <IconMic color="#4CC9F0" />
            <div className="grow col" style={{ gap: 2 }}>
              <strong>Set up your voice (2 min)</strong>
              <span className="t14 muted">Mic check, your range, headphone delay and your preferred note names.</span>
            </div>
          </div>
          <IntroVideoButton className="btn block" />
          <button className="btn primary block" data-testid="home-setup" onClick={() => go({ name: 'setup' })}>Start setup</button>
          {apiBase() && !loadSession() && ( // (logged in already: nothing to get back)
            <button className="linklike small muted" style={{ alignSelf: 'center', minHeight: 44 }} data-testid="home-account"
              onClick={() => openAccount('login')}>New phone? Log in to your choir account to get your progress back</button>
          )}
        </div>
      )}

      {plan.mode === 'welcome' && !done && (
        <p className="t16 muted" style={{ margin: 0 }} data-testid="welcome-line">Good to have you here. Everything you learnt is still there: let's ease back in with about {plan.minutes} minute{plan.minutes === 1 ? '' : 's'}.</p>
      )}
      {!betweenCycles && !concertOver && plan.mode !== 'welcome' && <StatusLine cycle={cycle} rehearsalDay={plan.mode === 'rehearsal'} />}
      {!betweenCycles && focusMissing.length > 0 && nr && nr.days >= 0 && (
        <span className="t14 muted" data-testid="rehearsal-focus">
          The next rehearsal also works on{' '}
          {focusMissing.map((w, i) => (
            <span key={w.title}>{i ? ', ' : ''}<button className="linklike" onClick={() => go({ name: 'pieces' })}>{w.title}</button></span>
          ))}{' '}(import your score first).
        </span>
      )}

      {profile.onboarded && <RehearsalCheck labOn={labOn} />}

      {done ? <TodayDone plan={plan} labOn={labOn} />
        : plan.steps.length > 0 ? (
          <PlanCard plan={plan} status={status} labOn={labOn} secondary={!profile.onboarded} rehearsalTime={rehearsalTime} started={!!today.started} />
        ) : statuses.length && !betweenCycles ? (
          <div className="notice info" data-testid="all-ready">Everything in this cycle is concert-ready. Keep them fresh, or train your ear under Train.</div>
        ) : !betweenCycles ? (
          <div className="notice info" data-testid="no-pieces">{labInProgramme()
            ? 'No scores in this cycle yet. Start with the intonation lab below.'
            : "No pieces in this cycle yet. Add some under Pieces or import your choir's MusicXML."}</div>
        ) : null}

      {plan.mode === 'rehearsal' && !done && <TonightsFocus statuses={statuses} />}
      {plan.mode === 'welcome' && !done && <LeftOff statuses={statuses} />}
      {everPractised && !done && (
        <WeekCard mode={plan.mode === 'rehearsal' ? 'rehearsal' : plan.mode === 'welcome' ? 'welcome' : afterRehearsal ? 'after' : 'normal'} nextRehearsalLabel={nextLabel} />
      )}

      <Notice />
      <SyncNotice />
      <LoggedOutCard />
      {sharingNeedsOk() && (
        <div className="card" data-testid="share-ask" style={{ gap: 8 }}>
          <span className="t14">Your choir now shares everyone's practice with the section leads: which bars are hard for the section (as totals) and your voice range. Yours isn't shared yet.</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => { startSharing(); void shareMyProgress(true); }}>Start sharing</button>
            <button className="btn small ghost" onClick={() => go({ name: 'choir' })}>What's shared</button>
          </div>
        </div>
      )}

      {betweenCycles && (
        <div className="notice info small" data-testid="between-cycles">
          {nextCycle
            ? <><strong>{choir?.name ?? 'Your choir'}: the last cycle is over.</strong> Next: {nextCycle.name}, from {formatDate(nextCycle.start)}.</>
            : <><strong>{choir?.name ?? 'Your choir'}: the last cycle is over.</strong> The next programme comes when your choir starts a new cycle.</>}
        </div>
      )}
      {!betweenCycles && concertOver && (
        <div className="notice info small col" style={{ gap: 8 }} data-testid="concert-over">
          <span>{fromChoir
            ? 'The concert is over. Your choir will publish the next programme here; until then, keep your pieces fresh.'
            : 'The concert is over. Set the dates of your next rehearsal and concert to plan the next cycle.'}</span>
          {!fromChoir && <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => openAt({ name: 'settings' }, 'settings-cycle')}>Set new dates</button>}
        </div>
      )}

      <PractisingNow />

      {labInProgramme() && <IntonationCard inProgramme />}
      </div>

      <div className="lay home-side">
      <section className="col home-rep" style={{ gap: 2 }}>
        <div className="row between">
          <h2>Repertoire</h2>
          <button className="btn ghost small" onClick={() => go({ name: 'pieces' })}>All pieces</button>
        </div>
        {statuses.map((s) => (
          <button key={s.piece.id} className="list-row" data-testid="piece-row" onClick={() => go({ name: 'piece', pieceId: s.piece.id })}>
            <div className="mono-tile">{initials(s.piece.composer || s.piece.title)}</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{s.piece.title}</span>
              <span className="t14 muted ellipsis">
                {[s.piece.composer, s.partName].filter(Boolean).join(' · ')}
                {s.next?.kind === 'fix' ? ` · ${s.toFix.reduce((n, f) => n + f.sectionIds.length, 0)} to fix` : s.fullDue ? ' · full run due for review' : s.due.length ? ` · ${s.due.length} due for review` : ''}
              </span>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              {(s.pct > 0 || pieceLabel(s) === 'not started') && <span className="mono small">{Math.round(s.pct * 100)}%</span>}
              <span className="tiny muted" data-testid="piece-row-level">{pieceLabel(s)}</span>
            </div>
          </button>
        ))}
        {(cycle.wanted ?? []).filter((w) => !statuses.some((s) => sameWork(s.piece.title, w.title))).map((w) => (
          <button key={w.title} className="list-row" onClick={() => go({ name: 'pieces' })} data-testid="wanted-row">
            <div className="mono-tile" style={{ color: 'var(--muted)', border: '1px dashed var(--line)', background: 'transparent' }}>+</div>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="ellipsis" style={{ fontWeight: 600, fontSize: 15 }}>{w.title}</span>
              <span className="t14 muted ellipsis">{[w.composer, w.note ?? 'import your choir’s score'].filter(Boolean).join(' · ')}</span>
            </div>
            <span className="badge muted">Import</span>
          </button>
        ))}
        {!betweenCycles && (
          <button className="link start" onClick={() => openAt({ name: 'settings' }, 'settings-cycle')} data-testid="edit-dates">
            {!nr && !cycle.concertDate ? 'Set rehearsal and concert dates' : 'Edit dates and rehearsal pieces'}
          </button>
        )}
      </section>

      {labOn && !labInProgramme() && <IntonationCard />}

      </div>
      </div>
    </main>
  );
}

/** Rehearsal day: where tonight's pieces stand. */
function TonightsFocus({ statuses }: { statuses: PieceStatus[] }) {
  const ids = new Set(loadCycle().focusPieceIds ?? []);
  const focus = statuses.filter((s) => ids.has(s.piece.id));
  if (!focus.length) return null;
  return (
    <section className="card" data-testid="tonights-focus">
      <h2 className="h3">Tonight's focus</h2>
      <div className="checklist">
        {focus.map((s) => {
          const ps = pathStatus(singableSections(s.piece, s.partId), getProgress(s.piece.id, s.partId));
          return (
            <div key={s.piece.id} className="li" style={{ alignItems: 'flex-start' }}>
              <div className="grow col" style={{ gap: 2 }}>
                <strong className="t16">{s.piece.title}</strong>
                {s.rehearsalReady
                  ? <span className="t14 good-text">Level {Math.min(5, s.pieceLevel)} reached ✓</span>
                  : <span className="t14 muted">{notStarted(s) ? 'Not started' : `Working on ${ps.here}`}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Welcome back: the pieces where they left off. */
function LeftOff({ statuses }: { statuses: PieceStatus[] }) {
  const rows = statuses.slice(0, 4);
  if (!rows.length) return null;
  return (
    <section className="card" data-testid="left-off">
      <h2 className="h3">Where you left off</h2>
      <div className="checklist">
        {rows.map((s) => {
          const ps = pathStatus(singableSections(s.piece, s.partId), getProgress(s.piece.id, s.partId));
          const nodes = meterNodes({ level: ps.pieceLevel, slow: ps.half && ps.working ? ps.working.level : 0, now: ps.working });
          return (
            <div key={s.piece.id} className="li">
              <div className="grow col" style={{ gap: 2 }}>
                <strong className="t16">{s.piece.title}</strong>
                {s.pieceLevel > 0
                  ? <span className="t14 good-text">Level {s.pieceLevel} reached ✓</span>
                  : <span className="t14 muted">{notStarted(s) ? 'Not started' : `Working on ${ps.here}`}</span>}
              </div>
              <LevelMeter nodes={nodes} label={s.piece.title} />
            </div>
          );
        })}
      </div>
    </section>
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
  // Practised already (a slow step counts too): where it stands, as on the piece's path.
  const sections = singableSections(s.piece, s.partId);
  const prog = getProgress(s.piece.id, s.partId);
  const started = sections.some((x) => { const sp = prog?.sections[x.id]; return !!sp && (sp.level > 0 || (sp.slow ?? 0) > 0 || sp.attempts > 0); });
  const w = started ? pathStatus(sections, prog).working : null;
  if (w) return `working on Level ${w.level} · ${stepWord(w.step)}`;
  return s.pct > 0 ? 'in progress' : 'not started';
}

export { sameWork };

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

/** Nothing sung in the piece yet (no level, no slow step, no attempt). */
function notStarted(s: PieceStatus): boolean {
  const prog = getProgress(s.piece.id, s.partId);
  return !singableSections(s.piece, s.partId).some((x) => { const sp = prog?.sections[x.id]; return !!sp && (sp.level > 0 || (sp.slow ?? 0) > 0 || sp.attempts > 0); });
}
