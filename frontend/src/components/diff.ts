/* Affichage du diff « attendu vs obtenu ». Le verdict AC/WA vient toujours du
   juge (côté serveur) ; ici on se contente de présenter les différences. La
   tolérance d'égalité copie celle du juge (Python str.rstrip : tout espace de
   fin, dont \r, et lignes vides finales ignorés) pour ne pas signaler comme
   différentes des lignes que le juge considère égales. */

export type DiffRow = { type: 'eq' | 'exp' | 'got'; text: string };

/** Classe de caractères des espaces de fin tolérés, source unique côté client :
    le diff (`rstrip` ci-dessous) et l'affichage (DiffView) la partagent, et elle
    doit rester alignée sur le juge (cf. backend `_TRAILING_WS`).
    NOTE: Kept in sync with backend's _TRAILING_WS by backend/tests/test_diff_parity.py */
const TRAILING_WS_CLASS = '[ \\t\\r\\f\\v]';
const TRAILING_WS_RE = new RegExp(`${TRAILING_WS_CLASS}+$`);
const TRAILING_WS_SPLIT_RE = new RegExp(`^(.*?)(${TRAILING_WS_CLASS}+)$`);

function rstrip(s: string): string {
  // Aligné sur Python str.rstrip() : espaces, tabulations et retours chariot.
  return s.replace(TRAILING_WS_RE, '');
}

/** Sépare une ligne en (corps, espaces de fin) selon la même classe d'espaces que
    le diff. Source unique : l'affichage (DiffView) rend visibles les espaces de fin
    sans redéfinir « espace de fin » de son côté. `[line, '']` s'il n'y en a pas. */
export function splitTrailingWs(line: string): [string, string] {
  const m = line.match(TRAILING_WS_SPLIT_RE);
  return m ? [m[1], m[2]] : [line, ''];
}

/** LCS sur le segment [lo, hi) de `a`/`b` (lignes déjà découpées). Isolé pour
    n'allouer la matrice DP que sur la partie qui diffère réellement, une fois les
    têtes et queues communes retirées (cf. lineDiff). */
function diffMiddle(a: string[], b: string[], aLo: number, aHi: number, bLo: number, bHi: number) {
  const m = aHi - aLo;
  const n = bHi - bLo;
  // Hard cap to avoid freezing the browser on pathological large/all-mismatch inputs.
  // If the product of mismatch lengths is too large, we fall back to a simple block diff.
  if (m * n > 65536) {
    const rows: DiffRow[] = [];
    for (let i = 0; i < m; i++) rows.push({ type: 'exp', text: a[aLo + i] });
    for (let j = 0; j < n; j++) rows.push({ type: 'got', text: b[bLo + j] });
    return rows;
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        rstrip(a[aLo + i]) === rstrip(b[bLo + j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (rstrip(a[aLo + i]) === rstrip(b[bLo + j])) {
      rows.push({ type: 'eq', text: a[aLo + i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'exp', text: a[aLo + i] });
      i++;
    } else {
      rows.push({ type: 'got', text: b[bLo + j] });
      j++;
    }
  }
  while (i < m) rows.push({ type: 'exp', text: a[aLo + i++] });
  while (j < n) rows.push({ type: 'got', text: b[bLo + j++] });
  return rows;
}

/** Diff par plus longue sous-séquence commune, à la tolérance d'espaces près.
    On retire d'abord les lignes communes en tête et en queue : le cas courant
    (une sortie presque juste) n'a qu'un petit segment central divergent, et seul
    ce segment paie le coût quadratique de la LCS — la troncature serveur borne le
    reste. */
export function lineDiff(expected: string, got: string): DiffRow[] {
  const a = expected.replace(/\n+$/, '').split('\n');
  const b = got.replace(/\n+$/, '').split('\n');
  const m = a.length;
  const n = b.length;

  let lo = 0;
  while (lo < m && lo < n && rstrip(a[lo]) === rstrip(b[lo])) lo++;
  let aHi = m;
  let bHi = n;
  while (aHi > lo && bHi > lo && rstrip(a[aHi - 1]) === rstrip(b[bHi - 1])) {
    aHi--;
    bHi--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < lo; i++) rows.push({ type: 'eq', text: a[i] });
  rows.push(...diffMiddle(a, b, lo, aHi, lo, bHi));
  for (let i = aHi; i < m; i++) rows.push({ type: 'eq', text: a[i] });
  return rows;
}
