import React, { useEffect, useMemo, useState } from 'react';
import { getPiece, useLibrary } from '../library';
import { back } from '../router';
import { IconBack, IconCheck, IconRestart } from '../icons';
import {
  lyricLines, makeQuiz, hasLyrics, loadQuizStats, recordAnswer, recordRound, type QuizQuestion, type QuizKind,
} from '../../game/lyrics';

const ROUND = 10;

const KIND: Record<QuizKind, { label: string; ask: string }> = {
  missing: { label: 'Missing word', ask: 'Which word fills the gap?' },
  next: { label: 'What comes next?', ask: 'Which line comes after this one?' },
  letters: { label: 'First letters', ask: 'Which line do these letters stand for?' },
};

const CSS = `
.lq-prompt { font-size: 20px; line-height: 1.4; font-weight: 600; overflow-wrap: anywhere; }
.lq-prompt.letters { font-family: var(--mono); letter-spacing: 0.04em; }
.lq-blank { display: inline-block; min-width: 3.2em; border-bottom: 2px solid var(--accent); color: var(--accent-text); text-align: center; }
.lq-choices { display: flex; flex-direction: column; gap: 8px; }
.lq-choice {
  min-height: 52px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); color: var(--text);
  padding: 10px 14px; text-align: left; font-size: 16px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere;
  display: flex; align-items: center; gap: 10px;
}
.lq-choice.right { border: 2px solid var(--good); background: #12301f; }
.lq-choice.wrong { border: 2px solid var(--bad); background: #331520; }
.lq-choice.dim { opacity: 0.55; }
.lq-choice .mark { margin-left: auto; flex: none; font-weight: 800; }
.lq-feedback { min-height: 24px; font-size: 15px; }
.lq-score { font-family: var(--mono); font-size: 54px; font-weight: 600; line-height: 1; }
.lq-miss { display: flex; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--surface-2); }
.lq-miss .bar-no { flex: none; font-family: var(--mono); font-size: 12px; color: var(--muted); min-width: 52px; }
.lq-miss .txt { overflow-wrap: anywhere; }
`;

function Shell({ title, sub, onBack, children }: { title: string; sub?: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <main className="screen">
      <style>{CSS}</style>
      <div className="topbar">
        <button className="icon-btn" aria-label="Back to the piece" onClick={onBack}><IconBack /></button>
        <div className="grow col" style={{ gap: 0 }}>
          <h1 className="ellipsis" style={{ margin: 0, fontSize: 22 }}>{title}</h1>
          {sub && <span className="small muted ellipsis">{sub}</span>}
        </div>
      </div>
      {children}
    </main>
  );
}

export function LyricsQuiz({ pieceId, partId }: { pieceId: string; partId: string }) {
  const lib = useLibrary();
  const piece = getPiece(pieceId);
  const part = piece?.score.parts.find((p) => p.id === partId);
  const lines = useMemo(() => (piece && part ? lyricLines(piece.score, part, piece.sections) : []), [piece, part]);
  const [round, setRound] = useState(0);
  const questions = useMemo<QuizQuestion[]>(
    () => (lines.length ? makeQuiz(lines, { count: ROUND, stats: loadQuizStats(pieceId, partId) }) : []),
    // a new round (with fresh stats) each time `round` changes
    [lines, round],
  );
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [results, setResults] = useState<{ q: QuizQuestion; correct: boolean }[]>([]);
  const done = questions.length > 0 && idx >= questions.length;
  const q = questions[idx];

  const goBack = () => back({ name: 'piece', pieceId });
  const next = () => {
    setPicked(null);
    setIdx((i) => i + 1);
  };
  const newRound = () => {
    setResults([]);
    setPicked(null);
    setIdx(0);
    setRound((r) => r + 1);
  };

  // A right answer moves on by itself after a moment; a wrong one waits so the right answer can be read.
  useEffect(() => {
    if (!q || picked == null || picked !== q.answer) return;
    const t = window.setTimeout(next, 1100);
    return () => clearTimeout(t);
  }, [picked, q]);

  useEffect(() => {
    if (done) recordRound(pieceId, partId, results.filter((r) => r.correct).length);
  }, [done]);

  if (!piece) {
    if (!lib.ready) return <Shell title="Lyrics quiz" onBack={goBack}><p className="muted" role="status">Loading the piece…</p></Shell>;
    return <Shell title="Not found" onBack={goBack}><p className="muted">This piece isn't on this device any more.</p></Shell>;
  }
  const sub = `${piece.title}${part ? ` · ${part.name}` : ''}`;
  if (!part) {
    return <Shell title="Lyrics quiz" sub={piece.title} onBack={goBack}><p className="muted">This part isn't in the piece. Go back and pick your part again.</p></Shell>;
  }
  if (!hasLyrics(lines)) {
    return (
      <Shell title="Lyrics quiz" sub={sub} onBack={goBack}>
        <div className="card">
          <strong style={{ fontSize: 18 }}>This part has no lyrics</strong>
          <span className="muted small">
            {lines.length
              ? 'It only sings on vowels or syllables like “la” here, so there is no text to learn.'
              : 'The score has no words under this part’s notes (scores imported from MIDI never do).'}
          </span>
          <button className="btn block" onClick={goBack}>Back to the piece</button>
        </div>
      </Shell>
    );
  }
  if (!questions.length) {
    const distinct = [...new Map(lines.filter((l) => !l.vocalise).map((l) => [l.norm, l])).values()];
    return (
      <Shell title="Lyrics quiz" sub={sub} onBack={goBack}>
        <div className="card">
          <strong style={{ fontSize: 18 }}>Too little text for a quiz</strong>
          <span className="muted small">The whole text of this part is short enough to learn at a glance:</span>
          <div className="col" style={{ gap: 4 }}>
            {distinct.map((l) => <span key={l.key} style={{ fontWeight: 600, fontSize: 17 }}>{l.text}</span>)}
          </div>
          <button className="btn block" onClick={goBack}>Back to the piece</button>
        </div>
      </Shell>
    );
  }

  if (done) {
    const score = results.filter((r) => r.correct).length;
    const missed = [...new Map(results.filter((r) => !r.correct).map((r) => [r.q.lineKey, r.q])).values()];
    const best = loadQuizStats(pieceId, partId).bestScore;
    return (
      <Shell title="Lyrics quiz" sub={sub} onBack={goBack}>
        <div className="card" style={{ alignItems: 'flex-start' }}>
          <span className="eyebrow">Round complete</span>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <span className="lq-score" data-testid="quiz-score">{score}</span>
            <span className="muted" style={{ fontSize: 20 }}>/ {questions.length}</span>
          </div>
          <span className="small" style={{ color: 'var(--voice)' }}>
            {score === questions.length ? 'Word-perfect!' : score >= questions.length * 0.8 ? 'Nearly there.' : score >= questions.length / 2 ? 'Getting there.' : 'Worth another look at the text.'}
            {best != null && best > score ? ` Your best: ${best}.` : ''}
          </span>
        </div>
        {missed.length > 0 && (
          <section className="col" style={{ gap: 4 }} aria-label="Lines to look at again">
            <h2 style={{ fontSize: 16 }}>Lines to look at again</h2>
            <span className="tiny muted">These come up more often in the next rounds.</span>
            {missed.map((m) => (
              <div key={m.lineKey} className="lq-miss">
                <span className="bar-no">bar {m.bar}</span>
                <span className="txt">{m.lineText}</span>
              </div>
            ))}
          </section>
        )}
        <button className="btn primary block" onClick={newRound}><IconRestart size={18} /> Another round</button>
        <button className="btn ghost block" onClick={goBack}>Back to the piece</button>
      </Shell>
    );
  }

  const answered = picked != null;
  const correct = answered && picked === q.answer;
  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    const ok = i === q.answer;
    setResults((r) => [...r, { q, correct: ok }]);
    recordAnswer(pieceId, partId, q, ok);
  };

  const promptNode = (() => {
    if (q.kind !== 'missing') return q.prompt;
    const [a, b] = q.prompt.split('____');
    return (
      <>
        {a}
        <span className="lq-blank" aria-label={answered ? undefined : 'blank'}>{answered ? q.choices[q.answer] : ' '}</span>
        {b}
      </>
    );
  })();

  return (
    <Shell title="Lyrics quiz" sub={sub} onBack={goBack}>
      <div className="col" style={{ gap: 6 }}>
        <div className="steps" aria-hidden="true">
          {questions.map((_, i) => <span key={i} className={i < idx ? 'done' : i === idx ? 'cur' : ''} />)}
        </div>
        <span className="tiny muted">Question {idx + 1} of {questions.length}</span>
      </div>

      <div className="card">
        <span className="eyebrow">{KIND[q.kind].label} · bar {q.promptBar}</span>
        <div className={`lq-prompt${q.kind === 'letters' ? ' letters' : ''}`} lang="">{promptNode}</div>
        <span className="small muted">{KIND[q.kind].ask}</span>
      </div>

      <div className="lq-choices" role="group" aria-label="Answers">
        {q.choices.map((c, i) => {
          const cls = !answered ? '' : i === q.answer ? ' right' : i === picked ? ' wrong' : ' dim';
          return (
            <button key={i} className={`lq-choice${cls}`} onClick={() => choose(i)} aria-disabled={answered || undefined}
              aria-label={answered ? `${c}${i === q.answer ? ' (right answer)' : i === picked ? ' (your answer, wrong)' : ''}` : undefined}>
              <span>{c}</span>
              {answered && i === q.answer && <span className="mark" style={{ color: 'var(--good)' }}><IconCheck size={20} color="var(--good)" /></span>}
              {answered && i === picked && i !== q.answer && <span className="mark" style={{ color: 'var(--bad)' }}>✕</span>}
            </button>
          );
        })}
      </div>

      <div className="lq-feedback" role="status" aria-live="polite">
        {answered && (correct
          ? <strong style={{ color: 'var(--good)' }}>Right!</strong>
          : (
            <div className="col" style={{ gap: 4 }}>
              <span><strong style={{ color: 'var(--bad)' }}>Not quite.</strong> It's “{q.choices[q.answer]}”.</span>
              {q.kind === 'missing' && <span className="small muted">Bar {q.bar}: {q.lineText}</span>}
            </div>
          ))}
      </div>
      {answered && (
        <button className="btn primary block" onClick={next}>{idx + 1 < questions.length ? 'Next' : 'See your score'}</button>
      )}
    </Shell>
  );
}
