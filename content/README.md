# Contenu ClubJudge

Problèmes et cours de la plateforme, versionnés ici et importés par le backend
(`clubjudge-content validate|import`, lancée localement et par la CI).
Le format est défini dans `PLAN.md` §3.

```
skills.yaml        arbre de compétences (nœuds, prérequis, problèmes rattachés,
                   liens `articles:` vers les cours)
problems/<slug>/   problem.yaml, statement.fr.md, editorial.fr.md, hints.yaml,
                   tests/, generator.py, validator.py, solutions/
courses/<slug>/    course.yaml + articles `NN-slug.fr.md` (l'ordre vient du
                   préfixe numérique ; traduction optionnelle en NN-slug.en.md)
```

## Format d'un article de cours

Un article commence par un frontmatter YAML optionnel puis un titre `# …`
obligatoire (qui devient son titre affiché) :

````markdown
---
practice:            # optionnel : problèmes « pour pratiquer » listés en fin
  - un-slug          #   d'article (et lien croisé depuis la page du problème)
---

# Titre de l'article

Markdown classique : LaTeX ($O(n \log n)$), tableaux, blocs de code colorés.

```tp
deux-sommes
```
````

Le bloc `tp` ci-dessus embarque le problème dans la page : éditeur, exécution
sur les exemples et soumission sans quitter l'article. Le slug doit exister
dans `problems/` et ne pas être aussi dans `practice`. La validation complète
passe par `clubjudge-content validate`.
