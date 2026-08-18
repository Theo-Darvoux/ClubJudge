import { useMemo } from 'react';
import { lineDiff, splitTrailingWs } from './diff';

/* Affiche le diff « attendu vs obtenu » : la tolérance d'égalité copie celle du
   juge, mais on rend le texte brut avec les espaces de fin visibles — un WA dû à
   un simple espace ou retour à la ligne devient ainsi lisible. */

function LineText({ text }: { text: string }) {
  // Aligné sur la tolérance du diff (cf. splitTrailingWs) : on rend visible tout
  // espace de fin, y compris un retour chariot \r isolé qui causerait un WA.
  const [body, trailing] = splitTrailingWs(text);
  if (!trailing) return <>{text === '' ? ' ' : text}</>;
  const marks = trailing
    .replace(/ /g, '·')
    .replace(/\t/g, '→')
    .replace(/\r/g, '␍')
    .replace(/[\f\v]/g, '▯');
  return (
    <>
      {body}
      <span className="ws-mark" title="espaces de fin">
        {marks}
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
