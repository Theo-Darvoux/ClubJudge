import { useMemo } from 'react';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import ocaml from 'highlight.js/lib/languages/ocaml';
import type { SubmissionLanguage } from '../api';

hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('ocaml', ocaml);

const HLJS_LANG: Record<SubmissionLanguage, string> = {
  cpp: 'cpp',
  c: 'c',
  python: 'python',
  java: 'java',
  ocaml: 'ocaml',
};

/* Bloc de code coloré (solutions partagées) : highlight.js + thème dans global.css. */
export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language: SubmissionLanguage;
  className?: string;
}) {
  const html = useMemo(
    () => hljs.highlight(code, { language: HLJS_LANG[language] }).value,
    [code, language],
  );
  return (
    <pre className={className}>
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
