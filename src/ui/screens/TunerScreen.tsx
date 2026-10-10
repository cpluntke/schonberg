import React from 'react';
import { useProfile } from '../hooks';
import { back } from '../router';
import { Tuner } from '../components/Tuner';
import { IconBack } from '../icons';

export function TunerScreen() {
  const [profile] = useProfile();
  return (
    <main className="screen">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => back({ name: 'train' })}><IconBack /></button>
        <h1>Tuner</h1>
      </div>
      <Tuner notation={profile.notation} />
      <span className="small muted">Note names follow your notation setting (fixed, relative to C for movable systems).</span>
    </main>
  );
}
