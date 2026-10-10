// The LevelMeter: the five levels of a piece or a passage (Notes, Words, Alone, Concert, By heart),
// one node each: empty, half (slow passed), full (in tempo passed); an orange ring on the step you
// are on; teal = reached. Small on rows; large with the names under the nodes (the piece's path,
// a milestone), optionally with a ♪ goal on a level (a rehearsal or concert date).
import React from 'react';
import { nodeLabel, type MeterNode } from '../path';

/** "Level 1 Notes: reached. Level 2 Words: slow passed; you are here" (what a small meter shows). */
export function meterSummary(nodes: MeterNode[]): string {
  const shown = nodes.filter((n) => n.fill !== 'empty' || n.now || n.goal);
  return shown.length ? shown.map(nodeLabel).join('. ') : 'No level reached yet';
}

export function LevelMeter({ nodes, size = 'sm', label, className }: {
  nodes: MeterNode[];
  size?: 'sm' | 'lg';
  /** What the meter is of ("Your path", "Bars 1–5"): the accessible name's start. */
  label?: string;
  className?: string;
}) {
  const cls = (n: MeterNode) => ['n', n.fill === 'empty' ? '' : n.fill, n.now ? 'now' : '', n.goal ? 'goal' : ''].filter(Boolean).join(' ');
  if (size === 'lg') {
    return (
      <div className={`lvl lg${className ? ` ${className}` : ''}`} role="list" aria-label={label ? `${label}: levels` : 'Levels'} data-testid="level-meter">
        {nodes.map((n) => (
          <div key={n.level} className={cls(n)} role="listitem" aria-label={nodeLabel(n)}>
            <i aria-hidden="true">{n.level}</i>
            <span aria-hidden="true">{n.name}{n.goal ? <><br />{n.goal}</> : null}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <span className={`lvl${className ? ` ${className}` : ''}`} role="img" aria-label={`${label ? `${label}: ` : ''}${meterSummary(nodes)}`} data-testid="level-meter-sm">
      {nodes.map((n) => <i key={n.level} className={cls(n)} />)}
    </span>
  );
}
