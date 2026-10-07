import React from 'react';
import { leaveTo, type Route } from '../router';
import { IconBack, IconHome } from '../icons';

/**
 * The top bar of every practice screen (Play, Results, the words, the lyrics quiz, the memory map,
 * cold starts): ← always goes back to the piece's page (`up`), ⌂ to Home. The screen can take over
 * either tap (Play pauses a run that's being sung instead of leaving).
 */
export function PracticeBar({ up, title, sub, heading, extra, onBack, onHome, className }: {
  /** The page below this screen: the piece (expert mode for its drills). */
  up: Route;
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** The title is the screen's heading (h1); otherwise the screen has its own (e.g. sr-only). */
  heading?: boolean;
  /** Shown before ⌂ (Play's score). */
  extra?: React.ReactNode;
  onBack?: () => void;
  onHome?: () => void;
  className?: string;
}) {
  const backLabel = up.name === 'piece' ? 'Back to the piece' : up.name === 'expert' ? 'Back to expert mode' : 'Back';
  return (
    <div className={`practice-bar${className ? ` ${className}` : ''}`} data-testid="practice-bar">
      <button className="icon-btn" aria-label={backLabel} data-testid="bar-back" onClick={onBack ?? (() => leaveTo(up))}><IconBack /></button>
      <div className="grow col practice-bar-title">
        {heading
          ? <h1 className="ellipsis">{title}</h1>
          : <span className="ellipsis title">{title}</span>}
        {sub && <span className="tiny muted ellipsis">{sub}</span>}
      </div>
      {extra}
      <button className="icon-btn" aria-label="Home" data-testid="bar-home" onClick={onHome ?? (() => leaveTo({ name: 'home' }))}><IconHome /></button>
    </div>
  );
}
