import React from 'react';

type P = { size?: number; color?: string };
const S = ({ size = 22, color = 'currentColor', children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const IconBack = (p: P) => <S {...p}><path d="M15 18l-6-6 6-6" /></S>;
export const IconMusic = (p: P) => <S {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></S>;
export const IconMic = (p: P) => <S {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5" /></S>;
export const IconRanks = (p: P) => <S {...p}><path d="M8 21V11M16 21V7M12 21V3M4 21h16" /></S>;
export const IconSliders = (p: P) => <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>;
export const IconHome = (p: P) => <S {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></S>;
export const IconFlame = (p: P) => <S {...p}><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M5 12l5 5 9-10" /></S>;
export const IconLoop = (p: P) => <S {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></S>;
export const IconDown = (p: P) => <S {...p}><path d="M12 5v14M5 12l7 7 7-7" /></S>;
export const IconUp = (p: P) => <S {...p}><path d="M12 19V5M5 12l7-7 7 7" /></S>;
export const IconClock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const IconStar = (p: P) => <S {...p}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></S>;
export const IconPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconTrash = (p: P) => <S {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></S>;
export const IconCube = (p: P) => <S {...p}><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 22V12M21 7l-9 5-9-5" /></S>;
export const IconEar = (p: P) => <S {...p}><path d="M6 9a6 6 0 1 1 12 0c0 4-4 5-4 9a3 3 0 0 1-6 0" /><path d="M10 9a2 2 0 1 1 4 0" /></S>;
export const IconShare = (p: P) => <S {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></S>;
export const IconRestart = (p: P) => <S {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></S>;
export const IconPlay = ({ size = 22, color = '#0B0D1A' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
);
export const IconPause = ({ size = 22, color = '#0B0D1A' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
);
export const IconStop = ({ size = 22, color = '#0B0D1A' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconShield = (p: P) => <S {...p}><path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></S>;
