import { common } from 'lowlight';
import ocaml from 'highlight.js/lib/languages/ocaml';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// OCaml n'est pas dans le jeu « common » de highlight.js ; on l'ajoute pour les
// blocs ```ocaml des articles (sinon ils s'affichent sans coloration).
const languages = { ...common, ocaml };

/* Rendu Markdown commun (énoncés, indices, articles de cours) :
   GFM + LaTeX + coloration syntaxique des blocs de code (thème dans global.css). */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, [rehypeHighlight, { languages }]]}
    >
      {children}
    </ReactMarkdown>
  );
}
