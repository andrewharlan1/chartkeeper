// Hand-drawn style icons for content kinds
// Matches the visual style of InstrumentIcon.tsx

import React from 'react';
import { PartKind } from '../types';

const S = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const icons: Record<PartKind, (size?: number) => React.ReactElement> = {
  // Part: single staff with note
  part: (size) => <S size={size}>
    <line x1="4" y1="8" x2="24" y2="8" strokeWidth="1"/>
    <line x1="4" y1="11" x2="24" y2="11" strokeWidth="1"/>
    <line x1="4" y1="14" x2="24" y2="14" strokeWidth="1"/>
    <line x1="4" y1="17" x2="24" y2="17" strokeWidth="1"/>
    <line x1="4" y1="20" x2="24" y2="20" strokeWidth="1"/>
    <ellipse cx="12" cy="15.5" rx="2.5" ry="2" fill="currentColor" stroke="none" transform="rotate(-15 12 15.5)"/>
    <line x1="14.2" y1="14" x2="14.2" y2="7" strokeWidth="1.8"/>
  </S>,

  // Score: stacked staves with brace
  score: (size) => <S size={size}>
    <path d="M6 4C4.5 9 4.5 19 6 24" strokeWidth="2.2"/>
    <line x1="7" y1="5" x2="24" y2="5" strokeWidth="0.9"/>
    <line x1="7" y1="8" x2="24" y2="8" strokeWidth="0.9"/>
    <line x1="7" y1="11" x2="24" y2="11" strokeWidth="0.9"/>
    <line x1="7" y1="17" x2="24" y2="17" strokeWidth="0.9"/>
    <line x1="7" y1="20" x2="24" y2="20" strokeWidth="0.9"/>
    <line x1="7" y1="23" x2="24" y2="23" strokeWidth="0.9"/>
  </S>,

  // Chart: chord symbols above a staff
  chart: (size) => <S size={size}>
    <line x1="4" y1="16" x2="24" y2="16" strokeWidth="0.9"/>
    <line x1="4" y1="19" x2="24" y2="19" strokeWidth="0.9"/>
    <line x1="4" y1="22" x2="24" y2="22" strokeWidth="0.9"/>
    <text x="5" y="12" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="serif">C</text>
    <text x="14" y="12" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold" fontFamily="serif">G</text>
  </S>,

  // Link: chain link
  link: (size) => <S size={size}>
    <path d="M12 16L16 12" strokeWidth="1.8"/>
    <path d="M9 19C7 21 7 24 9.5 24.5C12 25 13 23 15 21L13 19C11 21 10.5 21.5 9.5 21C8.5 20.5 9 19.5 10 18.5" strokeWidth="1.8"/>
    <path d="M19 9C21 7 21 4 18.5 3.5C16 3 15 5 13 7L15 9C17 7 17.5 6.5 18.5 7C19.5 7.5 19 8.5 18 9.5" strokeWidth="1.8"/>
  </S>,

  // Audio: speaker with sound waves
  audio: (size) => <S size={size}>
    <path d="M6 11L6 17L10 17L15 21L15 7L10 11Z" strokeWidth="1.8" fill="none"/>
    <path d="M18 10.5C19.5 12 19.5 16 18 17.5" strokeWidth="1.8"/>
    <path d="M20.5 8C23 11 23 17 20.5 20" strokeWidth="1.8"/>
  </S>,

  // Other: generic document with folded corner
  other: (size) => <S size={size}>
    <path d="M7 3L7 25L21 25L21 9L15 3Z" strokeWidth="1.8"/>
    <path d="M15 3L15 9L21 9" strokeWidth="1.5"/>
    <line x1="10" y1="14" x2="18" y2="14" strokeWidth="1"/>
    <line x1="10" y1="17.5" x2="18" y2="17.5" strokeWidth="1"/>
    <line x1="10" y1="21" x2="15" y2="21" strokeWidth="1"/>
  </S>,
};

export function ContentKindIcon({ kind, size = 20 }: { kind: PartKind; size?: number }) {
  const iconFn = icons[kind] ?? icons.other;
  return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{iconFn(size)}</span>;
}

/** Human-readable labels for each kind */
export const KIND_LABELS: Record<PartKind, string> = {
  part: 'Part',
  score: 'Score',
  chart: 'Chart',
  link: 'Link',
  audio: 'Audio',
  other: 'Other',
};
