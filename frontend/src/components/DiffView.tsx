import { useMemo } from 'react';
import { lineDiff } from './diff';

/* Affiche le diff « attendu vs obtenu » : la tolérance d'égalité copie celle du
   juge, mais on rend le texte brut avec les espaces de fin visibles — un WA dû à
   un simple espace ou retour à la ligne devient ainsi lisible. */

function LineText({ text }: { text: string }) {
  const match = text.match(/^(.*?)([ \t]+)$/);
  if (!match) return <>{text === '' ? ' ' : text}</>;
  const trailing = match[2].replace(/ /g, '·').replace(/\t/g, '→');
  return (
    <>
      {match[1]}
      <span className="ws-mark" title="espaces de fin">
        {trailing}
      </span>
    </>
  );
}

export function DiffView({ expected, got }: { expected: string; got: string }) {
  const rows = useMemo(() => lineDiff(expected, got), [expected, got]);
  return (
    <div className="diff-view" role="table">
      {rows.map((r, idx) => (
        <div key={idx} className={`diff-row diff-${r.type}`} role="row">
          <span className="diff-sign" aria-hidden="true">
            {r.type === 'exp' ? '−' : r.type === 'got' ? '+' : ' '}
          </span>
          <span className="diff-text">
            <LineText text={r.text} />
          </span>
        </div>
      ))}
    </div>
  );
}
