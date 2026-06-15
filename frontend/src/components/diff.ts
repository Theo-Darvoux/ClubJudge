/* Comparaison ligne à ligne « attendu vs obtenu ». La tolérance d'égalité copie
   celle du juge (espaces de fin de ligne et lignes vides finales ignorés). */

/** Même normalisation que le backend (_normalized_lines). */
export function normalizeLines(text: string): string[] {
  const trimmed = text.replace(/\n+$/, '');
  return trimmed.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
}

/** Sorties équivalentes pour le juge ? Sert au jugement local d'un exemple. */
export function outputsMatch(expected: string, got: string): boolean {
  const a = normalizeLines(expected);
  const b = normalizeLines(got);
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export type DiffRow = { type: 'eq' | 'exp' | 'got'; text: string };

function rstrip(s: string): string {
  return s.replace(/[ \t]+$/, '');
}

/** Diff par plus longue sous-séquence commune, à la tolérance d'espaces près. */
export function lineDiff(expected: string, got: string): DiffRow[] {
  const a = expected.replace(/\n+$/, '').split('\n');
  const b = got.replace(/\n+$/, '').split('\n');
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        rstrip(a[i]) === rstrip(b[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (rstrip(a[i]) === rstrip(b[j])) {
      rows.push({ type: 'eq', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'exp', text: a[i] });
      i++;
    } else {
      rows.push({ type: 'got', text: b[j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: 'exp', text: a[i++] });
  while (j < n) rows.push({ type: 'got', text: b[j++] });
  return rows;
}
