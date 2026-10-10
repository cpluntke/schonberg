// The Choir tab's overview for a member (the UX review's D2): the next rehearsal with its focus and
// one action, the programme, this week in your section (with who's practising right now), the short
// board of this week's points (all of Ranks behind "See all"), and what's shared.
import React, { useEffect, useState } from 'react';
import { programmePieces, singableSections, useLibrary, type PieceInfo } from '../library';
import { useProfile, useStoreVersion, initials } from '../hooks';
import { go, openAt, type Route } from '../router';
import { loadCycle, sameWork } from '../../progress/store';
import { nextRehearsal } from '../../progress/rehearsal';
import { combineEntries, getLeaderboardBackend, type LeaderboardEntry } from '../../progress/leaderboard';
import { cachedChoir, choirCycleNow, sharingNeedsOk } from '../../progress/choir';
import { presenceShown, usePresence } from '../../progress/presence';
import { pieceStatus, type PieceStatus } from '../plan';
import { myBoardEntry } from '../play/boardEntry';
import { focusAction, sectionWeek, weekBoard, weekStart } from '../choirTab';
import { dateWords, shortTitle } from '../today';
import { IconChevron, IconLock, IconPlay } from '../icons';
import { voiceName } from '../screens/Home';
import { avatarInitials } from '../nav';

const PLURAL: Record<string, string> = { S: 'sopranos', A: 'altos', T: 'tenors', B: 'basses' };

function inDays(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

export function ChoirOverview() {
  const [profile] = useProfile();
  useStoreVersion();
  useLibrary();
  const cycle = loadCycle();
  // (as on Today and in Ranks: the singer's own imports count, e.g. one that filled a wanted slot)
  const pieces = programmePieces(cycle);
  const statuses = pieces.map((p) => pieceStatus(p, profile.voice));
  return (
    <div className="lay choir-cols">
      <div className="lay choir-main">
        <RehearsalCard statuses={statuses} />
        <Programme pieces={pieces} />
      </div>
      <div className="lay choir-side">
        <Board pieces={pieces} />
        <Shared />
      </div>
    </div>
  );
}

/** The next rehearsal: when, what it works on, where you stand, and the one thing to do for it. */
function RehearsalCard({ statuses }: { statuses: PieceStatus[] }) {
  const cycle = loadCycle();
  const nr = nextRehearsal(cycle);
  if (!nr || nr.days < 0 || nr.over) return null;
  const focusIds = cycle.focusPieceIds ?? [];
  const focus = statuses.filter((s) => focusIds.includes(s.piece.id));
  const missing = (cycle.wanted ?? []).filter((w) => w.focus && !statuses.some((s) => sameWork(s.piece.title, w.title)));
  const when = `${dateWords(nr.at)}${cycle.rehearsalWeekday != null ? ` · ${cycle.rehearsalTime ?? '19:30'}` : ''}`;
  // The first focus piece that still needs work for rehearsal: its next step is the card's action.
  const work = focus.find((s) => !s.rehearsalReady && s.next);
  const label = (s: PieceStatus) => (id: string) => singableSections(s.piece, s.partId).find((x) => x.id === id)?.label ?? id;
  const action = work?.next ? focusAction(work.piece.title, work.next, label(work)) : null;
  const route: Route | null = work?.next
    ? { name: 'play', pieceId: work.piece.id, partId: work.partId, sectionId: work.next.sectionId, level: work.next.level, mode: '2d', step: work.next.step }
    : null;
  const ready = focus.filter((s) => s.rehearsalReady);
  const focusWords = [
    ...focus.map((s) => (s === work && work.next?.sectionId !== 'all' ? `${shortTitle(s.piece.title)} ${label(s)(work.next!.sectionId).toLowerCase()}` : s.piece.title)),
    ...missing.map((w) => w.title),
  ];
  return (
    <section className="card voice rehearsal-card" data-testid="choir-rehearsal" aria-labelledby="choir-rehearsal-h">
      <div className="row between">
        <span className="eb" id="choir-rehearsal-h">Next rehearsal</span>
        <span className="t14 muted">{inDays(nr.days)}</span>
      </div>
      <strong className="when">{when}</strong>
      {focusWords.length > 0
        ? <span className="t16">Focus: {focusWords.map((w, i) => <React.Fragment key={w}>{i ? (i === focusWords.length - 1 ? ' and ' : ', ') : ''}<strong>{w}</strong></React.Fragment>)}</span>
        : <span className="t14 muted">Your choir hasn't said which pieces it works on.</span>}
      {(action || ready.length > 0) && (
        <div className="focus-box">
          {action && <strong className="t16">{action.line}</strong>}
          {ready.map((s) => <span key={s.piece.id} className="t14 good-text">{s.piece.title} is rehearsal-ready ✓</span>)}
        </div>
      )}
      {action && route && (
        <button className="btn primary block" data-testid="choir-focus-go" onClick={() => go(route)}>
          <IconPlay size={18} /> {action.button}
        </button>
      )}
      {missing.length > 0 && <span className="t14 muted">{missing.map((w) => w.title).join(', ')}: no score in the app yet (Pieces).</span>}
    </section>
  );
}

/** The programme: its pieces as links, the ones still to come, the dates. */
function Programme({ pieces }: { pieces: PieceInfo[] }) {
  const [profile] = useProfile();
  const cycle = loadCycle();
  const choir = profile.choirCode ? cachedChoir() : null;
  const running = choir ? choirCycleNow(choir) as (ReturnType<typeof choirCycleNow> & { start?: string; end?: string }) | null : null;
  const coming = (cycle.wanted ?? []).filter((w) => !pieces.some((p) => sameWork(p.title, w.title)));
  const d = (x: string) => dateWords(x, { day: 'numeric', month: 'short' });
  const end = running?.end ?? cycle.concertDate;
  const dates = running?.start && end ? `${d(running.start)} – ${d(end)}` : '';
  return (
    <section className="col" style={{ gap: 10 }} data-testid="choir-programme" aria-labelledby="choir-programme-h">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2 id="choir-programme-h">{running?.name ?? cycle.name ?? 'The programme'}</h2>
        {dates && <span className="t14 muted">{dates}</span>}
      </div>
      {pieces.length === 0 && coming.length === 0 && <span className="t14 muted">No pieces in the programme yet.</span>}
      <div className="chips">
        {pieces.map((p) => (
          <button key={p.id} className="chip" data-testid="choir-programme-piece" onClick={() => go({ name: 'piece', pieceId: p.id })}>{shortTitle(p.title)}</button>
        ))}
        {coming.map((w) => (
          <button key={w.title} className="chip dashed" onClick={() => go({ name: 'pieces' })}>{shortTitle(w.title)} · coming</button>
        ))}
      </div>
      {cycle.concertDate && <span className="t14 muted">Concert {dateWords(cycle.concertDate)}</span>}
    </section>
  );
}

/** This week in your section, practising now, and the short board of this week's points. */
function Board({ pieces }: { pieces: PieceInfo[] }) {
  const [profile] = useProfile();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const programme = pieces.map((p) => p.id);
  const backend = getLeaderboardBackend();
  useEffect(() => {
    let alive = true;
    if (!profile.choirCode || !programme.length) { setEntries([]); setErr(null); return; }
    // (my own entries are posted after each run: this only reads the board)
    backend.list(profile.choirCode)
      .then((all) => { if (alive) { setEntries(combineEntries(all, programme)); setErr(null); } })
      .catch((e) => { if (alive) { setEntries(null); setErr((e as Error).message || 'unavailable'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.choirCode, programme.join(',')]);
  const mine = pieces.map((p) => myBoardEntry(p, profile.voice));
  const me0 = mine.length ? combineEntries(mine, programme)[0] ?? null : null;
  const me = me0 ? { ...me0, name: profile.name.trim() || me0.name, voice: profile.voice } : null;
  const since = weekStart();
  const week = sectionWeek(entries ?? [], profile.voice, me, since);
  const rows = weekBoard(entries ?? [], me, since);
  const voiceWord = PLURAL[profile.voice] ?? 'singers';
  const errLine = <span className="t14 muted" role="status" data-testid="choir-board-error">The choir's board can't be reached right now, so this can't be shown. Try again when you're online.</span>;
  return (
    <>
      <section className="card" data-testid="choir-section-week" aria-labelledby="choir-week-h">
        <div className="row between">
          <h2 id="choir-week-h" className="h3">This week in your section</h2>
          <span className="pill voice">{voiceName(profile.voice)}</span>
        </div>
        {err ? errLine
          : entries == null ? <span className="t14 muted">Looking at the board…</span>
          : week.total > 0 ? (
            <>
              <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                <strong className="big-count" data-testid="choir-section-count">{week.practised}</strong>
                <span className="t16 muted grow">of the {week.total} {voiceWord} on the board practised this week</span>
              </span>
              <span className="section-dots" aria-hidden="true">
                {Array.from({ length: Math.min(week.total, 24) }, (_, i) => <i key={i} className={i < week.practised ? (week.me && i === 0 ? 'on me' : 'on') : ''} />)}
              </span>
              <span className="t14 muted">{week.me ? `You're one of the ${week.practised} (ringed).` : 'Sing a passage this week and you count too.'}</span>
            </>
          ) : <span className="t14 muted">Nobody from your section is on the board yet.</span>}
        <PractisingNow />
      </section>

      <section className="card" data-testid="choir-board" aria-labelledby="choir-board-h">
        <h2 id="choir-board-h" className="h3">Points this week</h2>
        {err ? errLine : rows.length > 0 ? (
          <ol className="board-rows">
            {rows.map((r) => (
              <li key={`${r.entry.name}-${r.rank}`} className={r.me ? 'me' : ''}>
                <span className="mono muted rank">{r.rank}</span>
                <span className="ini" aria-hidden="true">{r.me ? avatarInitials(profile.name, profile.voice) : initials(r.entry.name)}</span>
                <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                  <strong className="t16 ellipsis">{r.me ? (profile.name.trim() ? `${profile.name.trim()} (you)` : 'You') : r.entry.name}</strong>
                  <span className="t14 muted">{voiceName(r.entry.voice)}</span>
                </span>
                <span className="mono pts">{r.entry.weeklyScore.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        ) : <span className="t14 muted">{entries == null ? 'Looking at the board…' : 'No points this week yet.'}</span>}
        {profile.boardHidden && <span className="t14 muted">You're off the choir's board: only you see your own row.</span>}
        <button className="link between-link" data-testid="choir-see-all" onClick={() => go({ name: 'ranks' })}>
          <span>See all</span><IconChevron size={18} />
        </button>
      </section>
    </>
  );
}

/** How many in the choir have the singing screen open right now, per voice part (live, no names). */
function PractisingNow() {
  const counts = usePresence();
  if (!presenceShown() || !counts) return null;
  const parts = (['S', 'A', 'T', 'B'] as const).filter((v) => counts[v]);
  const label = parts.length ? `Practising right now: ${parts.map((v) => `${counts[v]} ${counts[v] === 1 ? voiceName(v).toLowerCase() : PLURAL[v]}`).join(', ')}` : 'Nobody else is practising right now';
  return (
    <span className="row t14 muted" style={{ gap: 8 }} aria-live="off" data-testid="choir-practising-now">
      <span className={parts.length ? 'live-dot on' : 'live-dot'} aria-hidden />{label}
    </span>
  );
}

/** What your choir sees of your practice, in a sentence, and the way to the switches. */
function Shared() {
  const [profile] = useProfile();
  const voiceWord = PLURAL[profile.voice] ?? 'your section';
  const lead = sharingNeedsOk()
    ? 'Your practice isn’t shared with your section lead yet: your choir asks you to start sharing (Membership, below).'
    : profile.shareProgress
      ? `Your section lead and the admins see how your bars go only as totals for the ${voiceWord} (in a small section they may still tell which are yours), and your voice range by name.`
      : 'You don’t share your practice with your section lead.';
  const board = profile.boardHidden ? 'You’re not on the choir’s board.' : 'The board shows everyone in the choir your first name, voice and points.';
  return (
    <section className="row shared" style={{ alignItems: 'flex-start', gap: 12 }} data-testid="choir-shared">
      <span style={{ color: 'var(--muted)', marginTop: 2 }}><IconLock size={20} /></span>
      <span className="col grow" style={{ gap: 0 }}>
        <span className="t14 muted">{lead} {board}</span>
        <button className="link start" data-testid="choir-privacy" onClick={() => openAt({ name: 'settings' }, 'settings-privacy')}>Privacy</button>
      </span>
    </section>
  );
}
