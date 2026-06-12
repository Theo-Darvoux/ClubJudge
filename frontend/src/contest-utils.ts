import { useEffect, useState } from 'react';

/** Horloge partagée : re-rend à intervalle fixe (compte à rebours, phases). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
