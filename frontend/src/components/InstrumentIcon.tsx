// Hand-drawn style instrument icons for Scorva
// 20 instruments, auto-detected from name, user-selectable

import React, { useState } from 'react';

// ── SVG wrapper ───────────────────────────────────────────────────────────────

const S = ({ children, size = 28 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none"
    stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

// ── Icons ─────────────────────────────────────────────────────────────────────

export const InstrumentIcons: Record<string, (size?: number) => React.ReactElement> = {

  // Violin: tight hourglass body, f-holes, neck+scroll
  violin: (size) => <S size={size}>
    <path d="M11 5.5C9 5.5 7.5 7 7.5 9.5C7.5 11.8 9 12.8 11 13.5C9 14.2 7.5 15.2 7.5 17.5C7.5 20 9 22 11 22.5C12.2 22.8 15.8 22.8 17 22.5C19 22 20.5 20 20.5 17.5C20.5 15.2 19 14.2 17 13.5C19 12.8 20.5 11.8 20.5 9.5C20.5 7 19 5.5 17 5.5C15.8 5.2 12.2 5.2 11 5.5Z"/>
    <path d="M11.5 12C11 11 10.5 11.5 10.5 12.5C10.5 13.5 11 13.5 11.5 13" strokeWidth="1.1"/>
    <path d="M16.5 12C17 11 17.5 11.5 17.5 12.5C17.5 13.5 17 13.5 16.5 13" strokeWidth="1.1"/>
    <line x1="14" y1="5.5" x2="14" y2="2.5" strokeWidth="1.8"/>
    <path d="M14 2.5C13.5 2 12.8 2.3 13 3C13.2 3.7 14 3.5 14 2.5" strokeWidth="1.1"/>
  </S>,

  // Viola: same as violin, slightly wider
  viola: (size) => <S size={size}>
    <path d="M10.5 5C8 5 6.5 6.8 6.5 9.5C6.5 12 8.2 13 10.5 13.8C8.2 14.6 6.5 15.6 6.5 18C6.5 20.8 8 23 10.5 23.5C11.8 23.8 16.2 23.8 17.5 23.5C20 23 21.5 20.8 21.5 18C21.5 15.6 19.8 14.6 17.5 13.8C19.8 13 21.5 12 21.5 9.5C21.5 6.8 20 5 17.5 5C16.2 4.7 11.8 4.7 10.5 5Z"/>
    <path d="M11.5 12C11 11 10.5 11.5 10.5 12.5C10.5 13.5 11 13.5 11.5 13" strokeWidth="1.1"/>
    <path d="M16.5 12C17 11 17.5 11.5 17.5 12.5C17.5 13.5 17 13.5 16.5 13" strokeWidth="1.1"/>
    <line x1="14" y1="5" x2="14" y2="2" strokeWidth="2"/>
    <path d="M14 2C13.5 1.5 12.8 1.8 13 2.5C13.2 3.2 14 3 14 2" strokeWidth="1.1"/>
  </S>,

  // Cello: wide body, tall, endpin
  cello: (size) => <S size={size}>
    <path d="M9.5 4.5C7 4.5 5.5 6.5 5.5 9.5C5.5 12.2 7.2 13.3 9.5 14C7.2 14.7 5.5 15.8 5.5 18.5C5.5 21.5 7 24 9.5 24.5C11 24.8 17 24.8 18.5 24.5C21 24 22.5 21.5 22.5 18.5C22.5 15.8 20.8 14.7 18.5 14C20.8 13.3 22.5 12.2 22.5 9.5C22.5 6.5 21 4.5 18.5 4.5C17 4.2 11 4.2 9.5 4.5Z"/>
    <path d="M11 12C10.5 11 10 11.5 10 12.5C10 13.5 10.5 13.5 11 13" strokeWidth="1.1"/>
    <path d="M17 12C17.5 11 18 11.5 18 12.5C18 13.5 17.5 13.5 17 13" strokeWidth="1.1"/>
    <line x1="14" y1="4.5" x2="14" y2="1.5" strokeWidth="2.2"/>
    <line x1="14" y1="24.5" x2="14" y2="27.5"/>
  </S>,

  // Double Bass: very wide rounded body, long neck, endpin
  doubleBass: (size) => <S size={size}>
    <path d="M9 3.5C6 3.5 4 6 4 9.5C4 12.5 6 13.8 9 14.5C6 15.2 4 16.5 4 19.5C4 23 6 25.5 9 25.5C11 26 17 26 19 25.5C22 25.5 24 23 24 19.5C24 16.5 22 15.2 19 14.5C22 13.8 24 12.5 24 9.5C24 6 22 3.5 19 3.5C17 3 11 3 9 3.5Z"/>
    <line x1="14" y1="3.5" x2="14" y2="0.5" strokeWidth="2.3"/>
    <line x1="14" y1="25.5" x2="14" y2="28.5"/>
    <line x1="10.5" y1="9.5" x2="10.5" y2="20" strokeWidth="0.9"/>
    <line x1="17.5" y1="9.5" x2="17.5" y2="20" strokeWidth="0.9"/>
    <line x1="9.5" y1="14.5" x2="18.5" y2="14.5" strokeWidth="1.3"/>
  </S>,

  // Acoustic Guitar: hourglass body with sound hole, neck
  acousticGuitar: (size) => <S size={size}>
    <path d="M10 10C8 10 6 11.5 6 13.5C6 15 7 16 8.5 17C7 18 6 19 6 20.5C6 22.5 8 24 10 24.5C11.5 24.8 16.5 24.8 18 24.5C20 24 22 22.5 22 20.5C22 19 21 18 19.5 17C21 16 22 15 22 13.5C22 11.5 20 10 18 10C16.5 9.7 11.5 9.7 10 10Z"/>
    <circle cx="14" cy="17" r="3.2" strokeWidth="1.3"/>
    <line x1="14" y1="10" x2="14" y2="2.5" strokeWidth="2"/>
    <rect x="12" y="2" width="4" height="3" rx="1.5" strokeWidth="1.3"/>
    <line x1="7" y1="21.5" x2="21" y2="21.5" strokeWidth="1.1"/>
    <line x1="10.5" y1="10" x2="10.5" y2="24.5" strokeWidth="0.8"/>
    <line x1="17.5" y1="10" x2="17.5" y2="24.5" strokeWidth="0.8"/>
  </S>,

  // Electric Guitar: Strat-style offset body, two cutaways, neck
  electricGuitar: (size) => <S size={size}>
    <path d="M11 14C9 13 7 13 6 15C5 17 6 19 8 20C10 21 12 20 13 19C14 20 15.5 21.5 17 22C19 22.5 22 21 22 19C22 17 20 16 18.5 16.5C17.5 15 16 13.5 14 13Z"/>
    <path d="M13 7C12 6 11 5.5 11 14" strokeWidth="1.6"/>
    <path d="M14 13C14 5.5 15 5 16 4" strokeWidth="1.6"/>
    <rect x="14" y="2" width="4" height="3.5" rx="1.5" strokeWidth="1.3"/>
    <rect x="13.5" y="15" width="3" height="1.5" rx="0.5" strokeWidth="1" fill="currentColor"/>
    <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/>
  </S>,

  // Electric Bass: offset body, 4 strings visible on headstock
  electricBass: (size) => <S size={size}>
    <path d="M10 15C8 14 6 14 5.5 16C5 18 6.5 20 8.5 21C10.5 22 12 21 12.5 19.5C13.5 21 15.5 23 17.5 23C19.5 23 22 21 21.5 19C21 17 19 16 17 16.5C15.5 15 13.5 14 11.5 14.5Z"/>
    <path d="M12 6C11 5 10.5 4.5 10 15" strokeWidth="1.6"/>
    <path d="M12.5 14.5C12.5 4.5 14 4 15.5 3" strokeWidth="1.6"/>
    <rect x="13" y="1.5" width="4" height="3" rx="1.5" strokeWidth="1.3"/>
    <rect x="12.5" y="16" width="3" height="1.2" rx="0.4" strokeWidth="1" fill="currentColor"/>
  </S>,

  // Piano: front view — cabinet with keys
  piano: (size) => <S size={size}>
    <rect x="2" y="10" width="24" height="15" rx="2.5"/>
    <rect x="2" y="10" width="24" height="9" rx="2"/>
    {[5, 8.5, 12, 15.5, 19, 22.5].map((x: number) => <line key={x} x1={x} y1="10" x2={x} y2="25" strokeWidth="0.9"/>)}
    {[4, 7.2, 13.5, 16.8, 20.5].map((x: number) =>
      <rect key={x} x={x} y="10" width="2" height="6" rx="0.8" fill="currentColor" stroke="none"/>
    )}
  </S>,

  // Keyboard: synthesizer with keys and panel
  keyboard: (size) => <S size={size}>
    <rect x="1" y="8" width="26" height="12" rx="3"/>
    <rect x="3" y="12" width="22" height="7" rx="1.5"/>
    {[5.5, 8.5, 12, 15, 18.5, 21.5].map((x: number) => <line key={x} x1={x} y1="12" x2={x} y2="19" strokeWidth="0.9"/>)}
    {[4, 7, 13.5, 16.5, 20].map((x: number) =>
      <rect key={x} x={x} y="12" width="1.8" height="4.5" rx="0.6" fill="currentColor" stroke="none"/>
    )}
    <circle cx="6" cy="10" r="1" fill="currentColor" stroke="none"/>
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/>
    <line x1="13" y1="9" x2="22" y2="9" strokeWidth="1.5" strokeDasharray="2 2"/>
  </S>,

  // Drums: kick drum + hi-hat + crash + snare — simplified kit view
  drums: (size) => <S size={size}>
    {/* Kick drum */}
    <ellipse cx="14" cy="22" rx="8" ry="5"/>
    <ellipse cx="14" cy="22" rx="8" ry="2" strokeWidth="0.8"/>
    {/* Floor tom */}
    <ellipse cx="22.5" cy="17" rx="3.5" ry="2"/>
    <line x1="19" y1="17" x2="19" y2="22" strokeWidth="1.2"/>
    <line x1="26" y1="17" x2="26" y2="22" strokeWidth="1.2"/>
    {/* Hi-hat (left) */}
    <line x1="2" y1="9" x2="8" y2="9" strokeWidth="2"/>
    <line x1="2" y1="11" x2="8" y2="11" strokeWidth="1.5"/>
    <line x1="5" y1="11" x2="5" y2="17" strokeWidth="1.1"/>
    {/* Snare */}
    <ellipse cx="9" cy="17" rx="4" ry="2"/>
    <line x1="5" y1="17" x2="5" y2="21.5"/>
    <line x1="13" y1="17" x2="13" y2="21.5"/>
  </S>,

  // Trumpet: horizontal with 3 pistons, bell flaring right
  trumpet: (size) => <S size={size}>
    {/* Bell flare */}
    <path d="M19 9C21 9 25 10.5 25.5 14C25.5 17.5 21 19 19 19"/>
    {/* Body tubes */}
    <line x1="9" y1="11.5" x2="19" y2="11.5" strokeWidth="1.5"/>
    <line x1="9" y1="16.5" x2="19" y2="16.5" strokeWidth="1.5"/>
    {/* 3 Pistons */}
    <rect x="9.5" y="9" width="2.8" height="9" rx="1.4" strokeWidth="1.5"/>
    <rect x="13.3" y="9" width="2.8" height="9" rx="1.4" strokeWidth="1.5"/>
    <rect x="17" y="9" width="2.8" height="9" rx="1.4" strokeWidth="1.5"/>
    {/* Lead pipe curve */}
    <path d="M9.5 11.5C7 11.5 4.5 12 4 14C3.5 16 5 17 7 16.5C8 16.5 9 16.5 9.5 16.5" strokeWidth="1.4"/>
    {/* Mouthpiece */}
    <ellipse cx="3" cy="14" rx="1.5" ry="2" strokeWidth="1.3"/>
  </S>,

  // Trombone: long slide, bell
  trombone: (size) => <S size={size}>
    <path d="M2 8L14 8"/>
    <path d="M14 8C17 8 19 8.5 19 10.5C19 12.5 17 13 14 13"/>
    <line x1="2" y1="13" x2="14" y2="13"/>
    <line x1="8" y1="8" x2="8" y2="13" strokeWidth="3"/>
    <line x1="17" y1="8" x2="23" y2="8"/>
    <line x1="23" y1="8" x2="23" y2="22"/>
    <path d="M23 22C23 25 21 27 18 27C15 27 12 25 12 22C12 19 14 18 17 18"/>
    <line x1="2" y1="8" x2="2" y2="13" strokeWidth="1.5"/>
  </S>,

  // French Horn: coiled tubing, bell facing right
  frenchHorn: (size) => <S size={size}>
    <circle cx="13" cy="15" r="8"/>
    <circle cx="13" cy="15" r="4.5"/>
    <path d="M5 15C5 10 8 6.5 13 6.5"/>
    <line x1="13" y1="6.5" x2="13" y2="3"/>
    <line x1="11" y1="3" x2="15" y2="3"/>
    <path d="M21 15C21 20 18 23.5 13 23.5"/>
    <path d="M13 23.5C11 24 9 24.5 7 25C5.5 25.5 4 25 4 23.5C4 22 6 21 8 21"/>
  </S>,

  // Tuba: large upright bell, valves
  tuba: (size) => <S size={size}>
    <ellipse cx="14" cy="23" rx="10" ry="4"/>
    <path d="M4 23C4 18 6 13 8.5 11"/>
    <path d="M24 23C24 18 22 13 19.5 11"/>
    <path d="M8.5 11C8.5 7 10.5 4.5 14 4"/>
    <path d="M19.5 11C19.5 7 17.5 4.5 14 4"/>
    <rect x="9.5" y="11" width="2.5" height="5" rx="1.2"/>
    <rect x="13" y="10" width="2.5" height="5" rx="1.2"/>
    <rect x="16.5" y="11" width="2.5" height="5" rx="1.2"/>
    <line x1="14" y1="4" x2="14" y2="1"/>
  </S>,

  // Alto Saxophone: curved J-shape, wide bell
  saxophone: (size) => <S size={size}>
    {/* Neck crook at top */}
    <path d="M17 3C18.5 3 20 4 20 6C20 7.5 19 8.5 17.5 9"/>
    {/* Mouthpiece */}
    <line x1="17" y1="2" x2="19" y2="2" strokeWidth="2"/>
    {/* Body curving down */}
    <path d="M17.5 9C16 10 15 11 14 12.5C12 15.5 11 18 11 20C11 22.5 12.5 24.5 15 25C17.5 25.5 20 24 20.5 22"/>
    {/* Bell */}
    <path d="M15 25C14 26 12.5 26.5 11 26C9.5 25.5 8.5 24 9 22.5C9.5 21 11 20.5 12 21"/>
    {/* Keys */}
    <circle cx="15.5" cy="12" r="1.2" strokeWidth="1.2"/>
    <circle cx="14.5" cy="15" r="1.2" strokeWidth="1.2"/>
    <circle cx="13.5" cy="18" r="1.2" strokeWidth="1.2"/>
  </S>,

  // Flute: horizontal tube with embouchure hole and keys
  flute: (size) => <S size={size}>
    <line x1="2" y1="12" x2="27" y2="12" strokeWidth="4"/>
    <line x1="2" y1="15" x2="27" y2="15" strokeWidth="1.5"/>
    {/* Embouchure hole */}
    <ellipse cx="7" cy="12" rx="2" ry="1.5" fill="currentColor" stroke="none"/>
    {/* Keys */}
    {[12, 15.5, 19, 22.5].map((x: number) =>
      <circle key={x} cx={x} cy="13.5" r="1.4" strokeWidth="1.2"/>
    )}
    <line x1="27" y1="11" x2="27" y2="16" strokeWidth="2"/>
  </S>,

  // Clarinet: vertical tube with bell, register key, barrel
  clarinet: (size) => <S size={size}>
    {/* Mouthpiece + reed */}
    <path d="M11.5 2C11.5 2 12 1 14 1C14 1 15.5 2 15.5 3.5" strokeWidth="1.4"/>
    {/* Barrel */}
    <rect x="12" y="3.5" width="4" height="3" rx="1.5"/>
    {/* Body */}
    <line x1="13" y1="6.5" x2="13" y2="22" strokeWidth="3.5"/>
    <line x1="15" y1="6.5" x2="15" y2="22" strokeWidth="1.5"/>
    {/* Bell */}
    <path d="M12 22C11.5 24 11 25.5 10 26C12 27 16 27 18 26C17 25.5 16.5 24 16 22"/>
    {/* Register key */}
    <circle cx="14" cy="9" r="1.3" fill="currentColor" stroke="none"/>
    {/* Tone holes */}
    <circle cx="13.5" cy="12.5" r="1" strokeWidth="1.2"/>
    <circle cx="13.5" cy="15.5" r="1" strokeWidth="1.2"/>
    <circle cx="13.5" cy="18.5" r="1" strokeWidth="1.2"/>
  </S>,

  // Oboe: narrower than clarinet, double reed at top
  oboe: (size) => <S size={size}>
    {/* Double reed */}
    <path d="M12.5 2C13 1 14 0.5 14 1.5C14 1.5 14 0.5 15 1C15.5 1.5 15.5 2.5 15.5 3"/>
    {/* Body */}
    <line x1="13" y1="3" x2="13" y2="24" strokeWidth="3"/>
    <line x1="15" y1="3" x2="15" y2="24" strokeWidth="1.4"/>
    {/* Bell */}
    <path d="M12.5 23.5C12 25 11.5 26.5 10.5 27C12 27.8 16 27.8 17.5 27C16.5 26.5 16 25 15.5 23.5"/>
    {/* Tone holes */}
    <circle cx="13.5" cy="9" r="1" strokeWidth="1.2"/>
    <circle cx="13.5" cy="13" r="1" strokeWidth="1.2"/>
    <circle cx="13.5" cy="17" r="1" strokeWidth="1.2"/>
  </S>,

  // Vocals: classic microphone — round capsule, handle
  vocals: (size) => <S size={size}>
    {/* Capsule */}
    <path d="M10 14L10 8C10 4.5 18 4.5 18 8L18 14C18 16.5 16.5 17.5 14 17.5C11.5 17.5 10 16.5 10 14Z"/>
    {/* Mesh grid */}
    <line x1="10.5" y1="8" x2="17.5" y2="8" strokeWidth="0.9"/>
    <line x1="10" y1="11" x2="18" y2="11" strokeWidth="0.9"/>
    <line x1="10.5" y1="14" x2="17.5" y2="14" strokeWidth="0.9"/>
    {/* Neck collar */}
    <line x1="12" y1="17.5" x2="16" y2="17.5" strokeWidth="1.8"/>
    <line x1="13" y1="17.5" x2="13" y2="20"/>
    <line x1="15" y1="17.5" x2="15" y2="20"/>
    {/* Handle */}
    <rect x="11.5" y="20" width="5" height="7" rx="2.5"/>
  </S>,

  // Harp: triangular frame with strings
  harp: (size) => <S size={size}>
    <path d="M7 3C5 7.5 5 19 8 25" strokeWidth="2.5"/>
    <path d="M7 3C12 1.5 22 5 23 15"/>
    <line x1="23" y1="15" x2="8" y2="25" strokeWidth="2"/>
    <line x1="10" y1="7" x2="9.5" y2="23.5" strokeWidth="0.9"/>
    <line x1="13" y1="5.5" x2="12" y2="23.5" strokeWidth="0.9"/>
    <line x1="16.5" y1="5" x2="14.5" y2="23" strokeWidth="0.9"/>
    <line x1="20" y1="7" x2="17.5" y2="22" strokeWidth="0.9"/>
    <line x1="22.5" y1="12" x2="20.5" y2="21" strokeWidth="0.9"/>
  </S>,

  // Banjo: round drum body with neck
  banjo: (size) => <S size={size}>
    <circle cx="11" cy="17" r="9"/>
    <circle cx="11" cy="17" r="5.5"/>
    <line x1="19" y1="11" x2="27" y2="4" strokeWidth="2"/>
    <rect x="25.5" y="2.5" width="3" height="4.5" rx="1.2" strokeWidth="1.3"/>
    <line x1="11" y1="9" x2="11" y2="25" strokeWidth="0.9"/>
    <line x1="9" y1="9" x2="9" y2="25" strokeWidth="0.9"/>
    <line x1="13" y1="9" x2="13" y2="25" strokeWidth="0.9"/>
    <line x1="15" y1="10" x2="15" y2="24" strokeWidth="0.9"/>
  </S>,

  // Generic music note
  generic: (size) => <S size={size}>
    <path d="M10 18C10 20.2 8.2 22 6 22C3.8 22 2 20.2 2 18C2 15.8 3.8 14 6 14C8.2 14 10 15.8 10 18Z"/>
    <line x1="10" y1="18" x2="10" y2="4"/>
    <line x1="10" y1="4" x2="24" y2="2"/>
    <line x1="24" y1="14" x2="24" y2="2"/>
    <path d="M20 16C20 18.2 18.2 20 16 20C13.8 20 12 18.2 12 16C12 13.8 13.8 12 16 12C18.2 12 20 13.8 20 16Z"/>
  </S>,
};

// ── Keyword matching ──────────────────────────────────────────────────────────

const KEYWORD_MAP: Array<{ key: string; keywords: string[] }> = [
  { key: 'vocals',         keywords: ['vocal', 'voice', 'sing', 'lead', 'soprano', 'alto voice', 'mezzo', 'tenor voice', 'baritone voice', 'bass voice', 'mic', 'microphone'] },
  { key: 'doubleBass',     keywords: ['double bass', 'upright bass', 'contrabass', 'string bass', 'arco bass', 'pizzicato bass'] },
  { key: 'electricBass',   keywords: ['electric bass', 'bass guitar', 'e-bass', 'fender bass', 'bass guitar'] },
  { key: 'electricGuitar', keywords: ['electric guitar', 'elec guitar', 'lead guitar', 'rhythm guitar', 'e-guitar'] },
  { key: 'acousticGuitar', keywords: ['acoustic guitar', 'acoustic', 'nylon guitar', 'classical guitar', 'steel guitar'] },
  { key: 'banjo',          keywords: ['banjo'] },
  { key: 'piano',          keywords: ['piano', 'grand piano', 'upright piano', 'steinway'] },
  { key: 'keyboard',       keywords: ['keyboard', 'keys', 'synth', 'organ', 'wurlitzer', 'rhodes', 'mellotron', 'synthesizer'] },
  { key: 'drums',          keywords: ['drum', 'kit', 'percussion', 'snare', 'cymbals', 'trap', 'hi-hat', 'kick'] },
  { key: 'harp',           keywords: ['harp'] },
  { key: 'violin',         keywords: ['violin', 'fiddle'] },
  { key: 'viola',          keywords: ['viola'] },
  { key: 'cello',          keywords: ['cello', 'violoncello'] },
  { key: 'saxophone',      keywords: ['saxophone', 'sax', 'alto sax', 'tenor sax', 'bari sax', 'soprano sax', 'alto saxophone', 'tenor saxophone', 'baritone saxophone'] },
  { key: 'trumpet',        keywords: ['trumpet', 'cornet', 'flugelhorn'] },
  { key: 'trombone',       keywords: ['trombone', 'tbone', 'bass trombone'] },
  { key: 'frenchHorn',     keywords: ['french horn', 'horn', 'f horn'] },
  { key: 'tuba',           keywords: ['tuba', 'euphonium', 'baritone horn', 'sousaphone'] },
  { key: 'flute',          keywords: ['flute', 'piccolo'] },
  { key: 'clarinet',       keywords: ['clarinet', 'bass clarinet'] },
  { key: 'oboe',           keywords: ['oboe', 'english horn', 'bassoon', 'contrabassoon'] },
  // fallback: 'guitar' matches acoustic if no better match
  { key: 'acousticGuitar', keywords: ['guitar', 'mandolin', 'ukulele'] },
];

export function getIconKey(instrumentName: string): string {
  const lower = instrumentName.toLowerCase();
  for (const { key, keywords } of KEYWORD_MAP) {
    if (keywords.some(k => lower.includes(k))) return key;
  }
  return 'generic';
}

// ── Comprehensive instrument list for search dropdown ─────────────────────────

export const INSTRUMENT_LIST = [
  // Strings
  'Violin', 'Violin 1', 'Violin 2', 'Viola', 'Cello', 'Double Bass', 'Upright Bass',
  'Harp', 'Banjo', 'Mandolin', 'Ukulele',
  // Guitar/Bass
  'Electric Guitar', 'Acoustic Guitar', 'Classical Guitar', 'Bass Guitar', 'Electric Bass',
  'Pedal Steel Guitar', 'Dobro', '12-String Guitar',
  // Keys
  'Piano', 'Grand Piano', 'Upright Piano', 'Keyboard', 'Organ', 'Rhodes', 'Wurlitzer',
  'Synthesizer', 'Harpsichord', 'Accordion',
  // Brass
  'Trumpet', 'Trumpet 1', 'Trumpet 2', 'Trumpet 3', 'Flugelhorn', 'Cornet',
  'Trombone', 'Trombone 1', 'Trombone 2', 'Bass Trombone',
  'French Horn', 'French Horn 1', 'French Horn 2',
  'Tuba', 'Euphonium', 'Sousaphone', 'Baritone Horn',
  // Woodwinds
  'Alto Saxophone', 'Tenor Saxophone', 'Baritone Saxophone', 'Soprano Saxophone',
  'Flute', 'Piccolo', 'Oboe', 'English Horn',
  'Clarinet', 'Bass Clarinet', 'Bb Clarinet',
  'Bassoon', 'Contrabassoon',
  // Percussion
  'Drums', 'Drum Kit', 'Snare Drum', 'Bass Drum', 'Timpani',
  'Marimba', 'Xylophone', 'Vibraphone', 'Glockenspiel', 'Bells',
  'Congas', 'Bongos', 'Djembe', 'Cajon', 'Tambourine', 'Shakers', 'Cowbell',
  // Vocals
  'Vocals', 'Lead Vocals', 'Backup Vocals', 'Soprano', 'Alto', 'Tenor', 'Baritone', 'Bass',
  'Mezzo-Soprano', 'Countertenor', 'Choir',
];

// ── InstrumentIcon component ──────────────────────────────────────────────────

export function InstrumentIcon({ name, size = 28, onChangeIcon }: {
  name: string;
  size?: number;
  onChangeIcon?: (key: string) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [overrideKey, setOverrideKey] = useState<string | null>(null);
  const iconKey = overrideKey ?? getIconKey(name);
  const iconFn = InstrumentIcons[iconKey] ?? InstrumentIcons.generic;

  function handlePick(key: string) {
    setOverrideKey(key);
    setShowPicker(false);
    onChangeIcon?.(key);
  }

  const ICON_LABELS: Record<string, string> = {
    violin: 'Violin', viola: 'Viola', cello: 'Cello', doubleBass: 'Double Bass',
    acousticGuitar: 'Acoustic Guitar', electricGuitar: 'Electric Guitar', electricBass: 'Bass Guitar',
    piano: 'Piano', keyboard: 'Keyboard', drums: 'Drums', harp: 'Harp', banjo: 'Banjo',
    trumpet: 'Trumpet', trombone: 'Trombone', frenchHorn: 'French Horn', tuba: 'Tuba',
    saxophone: 'Saxophone', flute: 'Flute', clarinet: 'Clarinet', oboe: 'Oboe', vocals: 'Vocals',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setShowPicker(s => !s)}
        title="Change icon"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 2,
          color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          borderRadius: 6, transition: 'background 0.1s, color 0.1s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
          (e.currentTarget as HTMLElement).style.color = 'var(--text)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.background = 'none';
          (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
        }}
      >
        {iconFn(size)}
      </button>

      {showPicker && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onClick={() => setShowPicker(false)}
          />
          <div style={{
            position: 'absolute', left: 0, top: size + 8,
            zIndex: 101,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-lg)',
            padding: 10,
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4,
            width: 250,
          }}>
            {Object.entries(InstrumentIcons).filter(([k]) => k !== 'generic').map(([key, fn]) => (
              <button
                key={key}
                onClick={() => handlePick(key)}
                title={ICON_LABELS[key] ?? key}
                style={{
                  background: key === iconKey ? 'var(--accent-subtle)' : 'transparent',
                  border: `1px solid ${key === iconKey ? 'var(--accent-glow)' : 'transparent'}`,
                  borderRadius: 8, padding: 6, cursor: 'pointer',
                  color: key === iconKey ? 'var(--accent)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 3,
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => {
                  if (key !== iconKey) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }
                }}
                onMouseLeave={e => {
                  if (key !== iconKey) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                  }
                }}
              >
                {fn(20)}
                <span style={{ fontSize: 8, lineHeight: 1, textAlign: 'center', opacity: 0.7 }}>
                  {ICON_LABELS[key] ?? key}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
