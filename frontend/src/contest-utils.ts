import { useEffect, useState } from 'react';
import type { ContestPhase } from './api';

/** Horloge partagée : re-rend à intervalle fixe (compte à rebours, phases). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Horloge qui se fige à une échéance : re-rend chaque seconde tant que `until`
 *  (ms epoch) est dans le futur, puis s'arrête — inutile de re-rendre chaque
 *  seconde une page de contest déjà terminé. `until` null ⇒ tourne sans fin (le
 *  temps que les données chargent et fixent une échéance). */
export function useNowUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until !== null && Date.now() >= until) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (until !== null && t >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return now;
}

/** Phase vue par le client, recalculée à chaque tic d'horloge — peut devancer la
 *  phase du serveur (`contest.phase`) au moment précis d'une frontière. Doit
 *  rester alignée sur `contest_phase` côté backend (app/contests.py). Source
 *  unique partagée par la liste et le détail des contests. */
export function clientPhase(c: { start_at: string; end_at: string }, now: number): ContestPhase {
  if (now < Date.parse(c.start_at)) return 'upcoming';
  if (now < Date.parse(c.end_at)) return 'running';
  return 'finished';
}

/** Fenêtre du contest, compacte : « sam. 14 juin, 18:00 → 21:00 » (même jour). */
export function fmtWindow(startIso: string, endIso: string, lang: string): string {
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'long' };
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const sameDay = start.toDateString() === end.toDateString();
  const left = `${start.toLocaleDateString(locale, day)}, ${start.toLocaleTimeString(locale, time)}`;
  const right = sameDay
    ? end.toLocaleTimeString(locale, time)
    : `${end.toLocaleDateString(locale, day)}, ${end.toLocaleTimeString(locale, time)}`;
  return `${left} → ${right}`;
}

/** Durée restante en clair : « 2 j 03 h », « 1 h 23 min », « 4 min 12 s ». */
export function fmtCountdown(ms: number, lang: string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} ${lang === 'fr' ? 'j' : 'd'} ${String(h).padStart(2, '0')} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/** Minute de contest au format horloge ICPC : 83 → « 1:23 ». */
export function fmtContestMinute(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

/** Palette de ballons ICPC, distincte et lisible sur fond sombre. Le label fixe
 *  la teinte (A→0, B→1…) — stable quel que soit le sous-ensemble affiché. */
const BALLOON_PALETTE = [
  '#ff8b9e', // rose
  '#ffd07a', // or
  '#7fe0a7', // menthe
  '#9ec5ff', // ciel
  '#dcb7ff', // lavande
  '#ffab7f', // pêche
  '#b4dd86', // tilleul
  '#7fe0d4', // turquoise
  '#ff9ed6', // fuchsia
  '#c5a3ff', // violet
];

/** Couleur du ballon d'un problème, fixée par son label ('A', 'B'…). */
export function balloonColor(label: string): string {
  const i = label.toUpperCase().charCodeAt(0) - 65; // 'A' → 0
  const n = BALLOON_PALETTE.length;
  return BALLOON_PALETTE[((i % n) + n) % n];
}
