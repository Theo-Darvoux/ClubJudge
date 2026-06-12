# ClubJudge — Plan d'attaque

Plateforme de programmation compétitive du Club Code de Télécom SudParis.
Alternative moderne à DOMJudge, avec trois sections : **liste de problèmes**,
**compétitions**, **cours avec TP interactifs**.

> Document de référence du projet — mis à jour au fil des décisions.
> Dernière mise à jour : 2026-06-12.

## 1. Objectifs et philosophie

- **Projet d'apprentissage** : on construit la plateforme de zéro. La seule
  brique réutilisée telle quelle est le moteur d'exécution (Judge0), car une
  sandbox sécurisée est un projet de sécurité à part entière.
- **Pas de deadline** : la qualité et l'apprentissage priment sur la date.
- **Développeur principal** : psders, contributions ponctuelles d'autres
  membres possibles.

## 2. Décisions actées

| Sujet | Décision |
|---|---|
| Moteur de juge | **Judge0 auto-hébergé** (API REST, file de soumissions incluse) |
| Backend | **FastAPI** + SQLAlchemy + Alembic + Pydantic |
| Base de données | **PostgreSQL** |
| Frontend | Séparé du backend ; **React + TypeScript + Vite** (confirmé) |
| Hébergement | Serveur de l'école / du club — tout en **Docker Compose** |
| Authentification | Comptes classiques email + mot de passe, **sessions cookie** (HttpOnly, SameSite) — restriction possible au domaine école |
| Langages de soumission | C++, Python, C, Java au lancement (Judge0 en permet d'autres facilement) |
| Scoring des contests | **ICPC seul** au début (résolu/non-résolu + pénalité temps) ; modèle de données extensible |
| Gestion du contenu | Contenu en fichiers dans le dossier **`content/` du monorepo** (extractable en dépôt séparé plus tard) — pas d'interface d'édition web au début |
| Ordre de construction | Problèmes → Contests → Cours |
| Langues | **Bilingue FR/EN à terme** : i18n de l'UI dès le squelette, format de contenu multilingue (énoncés FR d'abord, traductions au fil de l'eau) |
| Partage de solutions | Le code des autres membres est visible **après son propre AC** sur le problème |
| Aide IA | **Aucune IA intégrée** (décision ferme) — on apprend en séchant ; indices rédigés par les auteurs, entraide entre membres |
| Intégrations | **Bot/webhooks Discord** du club (annonces, first bloods, badges...) |
| Direction artistique | **Reprise du design system de clubcode.fr** (voir §6) — sombre, lavande, coins crantés |

## 3. Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Front SPA  │────▶│  API FastAPI │────▶│  PostgreSQL │
│ React + TS  │     │              │     └─────────────┘
└─────────────┘     │  - auth      │     ┌─────────────┐
                    │  - problèmes │────▶│   Judge0    │
                    │  - contests  │     │ (API + ses  │
                    │  - cours     │     │  workers)   │
                    │  - import    │     └─────────────┘
                    └──────────────┘
                           ▲
                ┌──────────┴──────────┐
                │  Dépôt Git contenu  │
                │ (problèmes, cours)  │
                └─────────────────────┘
```

Principes :

- **Le juge derrière une interface.** Le code de la plateforme ne parle jamais
  à Judge0 directement : tout passe par un module `judge/` avec une interface
  abstraite (`submit(code, language, tests) -> verdict`). Si un jour on veut
  migrer vers un worker custom basé sur `isolate` (problèmes interactifs,
  checkers très custom), seul ce module change.
- **La soumission est le concept central.** Une soumission appartient à un
  utilisateur et un problème, et *optionnellement* à un contest ou un TP de
  cours. Les trois sections partagent ainsi le même pipeline de jugement.
- **Le contenu vit dans Git, la plateforme l'importe.** Un endpoint/commande
  d'import lit le dépôt de contenu, valide le format, et synchronise la base.
  Avantages : versionné, relecture en PR, pas d'UI d'édition à coder.

### Format du dépôt de contenu (à affiner en Phase 1)

```
content/
├── problems/
│   └── deux-sommes/
│       ├── problem.yaml        # titre, difficulté, tags, limites temps/mémoire
│       ├── statement.fr.md     # énoncé (Markdown + LaTeX) ; statement.en.md optionnel
│       ├── editorial.fr.md     # solution rédigée par l'auteur (visible après AC)
│       ├── hints.yaml          # indices progressifs (1, 2, ...) rédigés par l'auteur
│       ├── tests/
│       │   ├── 01.in / 01.out
│       │   └── ...
│       ├── generator.py        # optionnel : génère les gros tests (commiter le
│       ├── validator.py        #   générateur, jamais 50 Mo de .in dans Git)
│       └── solutions/          # solutions de référence (validation des tests)
│           └── solution.cpp
└── courses/
    └── intro-algo/
        ├── course.yaml         # titre, catégorie, ordre des articles
        └── 01-complexite.md    # article ; blocs TP référencent des problèmes par slug
```

**Le contenu est le risque n°1 du projet, pas le code** : un bon problème coûte
3-5 h (énoncé, tests, solution, indices) et la plateforme ne vaut rien sans
~40-50 problèmes couvrant l'arbre de compétences. D'où un volet outillage auteur
traité comme un citoyen de première classe :

- **CLI de validation** (`clubjudge-content validate`) : vérifie le format,
  génère les tests, exécute les solutions de référence dans les limites — lancée
  localement par l'auteur ET par la CI du dépôt de contenu sur chaque PR.
- **Sprints d'écriture de problèmes** au club, en parallèle du développement :
  viser ~10 problèmes prêts dès la fin de la Phase 1a, pas après la Phase 3.

## 4. Phases de développement

Chaque phase produit quelque chose d'utilisable par le club.

### Phase 0 — Fondations
*Objectif : une soumission "hello world" jugée de bout en bout.*

- [x] Init du monorepo (`backend/`, `frontend/`, `content/` ou dépôt séparé), git, README.
- [x] `docker-compose.yml` : PostgreSQL + Judge0 (+ son Redis) + backend + frontend.
- [x] Squelette FastAPI : healthcheck, config, SQLAlchemy + première migration Alembic.
- [x] Module `judge/` : interface abstraite + implémentation Judge0 ; test
      d'intégration qui soumet un programme C++ et Python et vérifie le verdict.
      *(Piège rencontré : Judge0 1.13.1 + hôte cgroup v2 → mode rlimit activé,
      cf. `docs/operations.md`.)*
- [x] Squelette front (Vite + React + TS), appel API de test, **i18n branché dès le squelette** (FR/EN — quasi gratuit maintenant, pénible à rétrofitter).
- [x] CI (lint + tests) dès le départ.
- [ ] **Déploiement sur le serveur cible dès cette phase** (compose + reverse
      proxy + TLS) : les surprises d'infra (droits Docker, cgroups pour Judge0,
      SMTP disponible ou non) doivent arriver maintenant, pas avant le premier contest.

### Phase 1 — Socle : problèmes et soumissions

C'est la plus grosse phase du projet — livrée en **deux jalons** pour que
l'utilisable arrive vite. Résister à l'envie d'y glisser le reste du catalogue (§5).

#### Phase 1a — Le strict minimum utilisable en séance
*Objectif : un membre se connecte, choisit un problème, soumet, voit son verdict.*

- [ ] Auth : inscription/connexion email + mot de passe (hash argon2/bcrypt, sessions cookie HttpOnly/SameSite), rôles `member`/`admin`.
- [ ] Vérification d'email et reset de mot de passe (dépend du SMTP validé en Phase 0).
- [ ] Modèle et import des problèmes depuis le dépôt de contenu (validation du format, génération des tests, exécution des solutions de référence contre les tests) — même code que la CLI auteur (§3).
- [ ] Liste des problèmes : filtres par catégorie, difficulté, thème ; recherche.
- [ ] Page problème : énoncé (Markdown + LaTeX), limites, soumission de code (éditeur Monaco), historique de ses soumissions.
- [ ] Pipeline de soumission : **soumissions persistées en base avant tout envoi au juge** (rejouables si Judge0 tombe), file avec retry, envoi à Judge0, verdicts détaillés (AC/WA/TLE/MLE/RE/CE), feedback en quasi-temps réel (polling d'abord, WebSocket/SSE plus tard).
- [ ] Rate limiting des soumissions (par utilisateur et global) — protège la file et la machine.
- [ ] Statut "résolu" par utilisateur, visible dans la liste.
- 🎯 **Jalon : une séance du club peut se tenir entièrement sur la plateforme.**

#### Phase 1b — Le confort pédagogique
*Objectif : la plateforme aide à apprendre, pas seulement à juger.*

- [ ] Éditeur : sauvegarde auto du code (localStorage par problème/langage), templates de départ par langage.
- [ ] Bouton « Exécuter sur les exemples » + entrée custom — ne compte pas comme soumission, lève la peur de soumettre.
- [ ] Indices progressifs (dépliables un à un, avec confirmation) et éditorial de l'auteur, depuis le dépôt de contenu.
- [ ] Solutions des autres membres visibles après son propre AC (filtre par langage, tri par temps/mémoire).
- 🎯 **Jalon : la plateforme remplace un usage type "france-ioi" pour les séances du club.**

### Phase 1.5 — Arbre de compétences
*Objectif : la section Problèmes s'ouvre sur un arbre de compétences façon talent tree, qui guide la progression.*

Décision du 2026-06-12. Principes :

- **Déblocage souple** : les nœuds ont des états visuels (recommandé / maîtrisé /
  pas encore prêt) mais aucun problème n'est verrouillé — l'arbre guide sans enfermer.
- **Une vue, pas un remplacement** : l'arbre devient la page d'accueil de la
  section Problèmes ; la liste filtrable de la Phase 1 reste accessible. Mêmes données.
- Un nœud = une compétence (ex. « récursivité ») rattachée à 3-5 problèmes ;
  maîtrisé quand N des M problèmes sont résolus — calculé depuis les soumissions
  existantes.

- [ ] Format `skills.yaml` dans le dépôt de contenu : nœuds, prérequis, problèmes
      rattachés, positions (fixées à la main). Validation à l'import : DAG, slugs existants.
- [ ] API : graphe + état des nœuds pour l'utilisateur courant.
- [ ] Rendu front : SVG custom ou react-flow, layout radial autour d'un nœud central.
- [ ] Liens des nœuds vers les articles de cours correspondants (anticipe la Phase 3).
- ⚠️ **Chemin critique éditorial, pas technique** : découper le programme du club
  en compétences et prérequis sensés — à faire collectivement au club.
- 🎯 **Jalon : un nouveau membre sait quoi travailler ensuite sans demander.**

### Phase 2 — Compétitions (ICPC)
*Objectif : le club peut organiser un contest interne.*

- [ ] Modèle contest : titre, fenêtre temporelle, ensemble de problèmes, inscrits.
- [ ] Inscription à un contest ; visibilité des problèmes seulement pendant la fenêtre.
- [ ] Scoring ICPC : classement par problèmes résolus puis pénalité (temps + 20 min/essai raté).
- [ ] Scoreboard en direct ; page de résultats finale.
- [ ] Plusieurs contests simultanés ou passés consultables (mode "upsolving" : les problèmes rejoignent la liste générale après le contest).
- [ ] First blood par problème, mis en avant sur le scoreboard (les « ballons » ICPC).
- [ ] Webhook Discord : annonce de contest (création, rappel, début), first bloods, résultats.
- [ ] Outils admin minimaux : rejudge d'une soumission/d'un problème.
- 🎯 **Jalon : premier contest du club hébergé sur ClubJudge.**

### Phase 3 — Cours et TP interactifs
*Objectif : les nouveaux membres se forment en autonomie.*

- [ ] Modèle et import des cours/articles depuis le dépôt de contenu, organisés par catégorie.
- [ ] Rendu des articles (Markdown, LaTeX, coloration syntaxique des extraits de code).
- [ ] Blocs TP interactifs dans les articles : éditeur + exécution contre les tests d'un problème lié, sans quitter la page.
- [ ] Liens croisés : un article référence des problèmes de la liste ("pour pratiquer : …"), une page problème peut pointer vers l'article qui couvre la notion.
- [ ] Suivi de progression simple (articles lus, TP réussis).
- 🎯 **Jalon : un parcours d'intro complet (articles + TP) pour la rentrée des nouveaux.**

### Phase 4 — Extensions

Le backlog détaillé vit dans le **catalogue de fonctionnalités (§5)** ci-dessous.
Rappel des gros chantiers techniques qui s'y ajoutent :

- Scoring IOI par subtasks (le modèle de données le prévoit dès la Phase 2).
- Checkers custom et problèmes interactifs — possible en partie avec Judge0, plus
  propre avec un worker `isolate` custom (prévu par l'interface `judge/`).
- Interface d'édition web du contenu pour les non-développeurs.
- SSO école (CAS/LDAP) si accès accordé.
- Contests par équipes ; gel du scoreboard ; clarifications.
- WebSocket/SSE pour les verdicts et le scoreboard temps réel.

## 5. Catalogue de fonctionnalités (brainstorm du 2026-06-12)

Vision cible : une plateforme **fonctionnelle, divertissante et pédagogique**.
Priorités : ★ = cœur, à caser dans les Phases 0-3 (déjà reporté dans les
checklists ci-dessus quand c'est acté) · ◐ = V2, peu après le jalon concerné ·
○ = idée retenue, non engagée.

### 5.1 Pédagogie

Philosophie actée : **pas d'IA intégrée**. La friction fait partie de
l'apprentissage ; l'aide vient des indices d'auteur, de l'éditorial, du code des
autres et de l'entraide humaine (Discord, séances).

- ★ **Indices progressifs** par problème, rédigés par l'auteur (`hints.yaml`),
  dépliables un à un avec confirmation — on choisit consciemment de se spoiler un peu.
- ★ **Éditorial officiel** par problème, visible après son AC (ou déblocage
  volontaire explicite hors contest, marqué comme « abandonné » plutôt que résolu).
- ★ **Solutions des autres après AC** : filtre par langage, tri par temps/mémoire —
  lire du meilleur code que le sien est un des plus gros accélérateurs de progression.
- ★ **Exécution sur les exemples + entrée custom** sans que ça compte comme
  soumission (lève la peur de soumettre chez les débutants).
- ★ **WA pédagogique hors contest** : montrer l'entrée du premier test échoué,
  si le problème l'autorise (flag `expose_failing_test` dans `problem.yaml`,
  désactivé pour les problèmes où ça donnerait la réponse).
- ◐ **Histogramme temps/mémoire** des AC d'un problème, avec « vous êtes ici » —
  pousse naturellement à optimiser après un premier AC.
- ◐ **Complexité attendue** affichée en spoiler dépliable (« résoluble en O(n log n) »).
- ◐ **« Et maintenant ? »** : suggestion du prochain problème d'après l'arbre de
  compétences et l'historique (raté un problème de DP → un plus simple + l'article lié).
- ◐ **Quiz de positionnement** à l'inscription → recommande une zone de départ
  dans l'arbre de compétences au lieu de larguer le nouveau au nœud racine.
- ◐ **Fiches de synthèse** (cheat sheets) par compétence, liées aux nœuds de
  l'arbre et imprimables.
- ◐ **QCM intégrés aux articles de cours** (auto-correction immédiate) — plus
  léger qu'un TP, vérifie la compréhension entre deux sections.
- ○ **Entraînement chronométré** : mini virtual-contest personnel généré sur N
  problèmes de son niveau (réutilise l'infra contest).
- ○ **Révision espacée** : re-proposer un problème *similaire* quelques semaines
  après un AC laborieux — la compétence se consolide, ne se valide pas une fois.
- ○ **Tests téléchargeables après AC** (flag par problème) : inspecter les vrais
  tests après coup est très formateur — et désamorce les « mais mon code marche ».
- ○ **Commentaires sous les solutions partagées** : mini code-review entre
  membres (modération nécessaire — à n'ouvrir que si le club est assez actif).

### 5.2 Gamification

Garde-fous actés : récompenses **cosmétiques uniquement**, jamais d'économie de
points, jamais de contenu verrouillé (cf. arbre de compétences, déblocage souple).

- ★ **Badges/succès**, dont des badges cachés à découvrir (premier AC, série de
  AC du premier coup, upsolving complet d'un contest, AC à 3h du matin...).
- ★ **Heatmap d'activité** façon GitHub sur le profil.
- ★ **Niveaux/XP** pondérés par la difficulté des problèmes résolus — progression
  continue entre les nœuds discrets de l'arbre.
- ★ **Problèmes boss** au bout de chaque branche de l'arbre de compétences,
  mis en scène comme tels (déjà en Phase 1.5).
- ◐ **Maisons par promo** : points collectifs sur le semestre — la mécanique
  sociale n°1 pour un club, elle incite les forts à aider les débutants.
- ◐ **Problème de la semaine** avec badge dédié, annoncé sur Discord — crée le
  rendez-vous hebdomadaire.
- ◐ **Classements mensuels** réinitialisés + « most improved » du mois (jamais de
  classement global permanent : il fige et démotive à l'échelle d'un club).
- ◐ **First blood / ballons** en contest (déjà en Phase 2).
- ○ **Duels lockout 1v1** (premier AC sur chaque problème le verrouille) — parfait
  en fin de séance au vidéoprojecteur ; réutilise l'infra contest.
- ○ **Participation virtuelle** : rejouer un contest passé en conditions réelles,
  contre le scoreboard « fantôme » des vrais participants.
- ○ **Cosmétiques de profil** débloqués par badges (avatars, bannières, titres).
- ○ **Streak hebdomadaire** (pas quotidien), avec gel automatique pendant les
  vacances — seulement si la demande émerge.

### 5.3 Confort & qualité de vie

- ★ **Sauvegarde auto** du code dans l'éditeur + **templates par langage** (Phase 1).
- ★ **i18n FR/EN de l'UI** dès le squelette ; contenu multilingue par le format
  `statement.<lang>.md` avec repli sur le français (Phase 0).
- ★ **File de jugement visible** : statut et position de sa soumission en quasi-temps réel.
- ★ **Mode sombre** (par défaut — public de programmeurs) et **responsive** : les
  cours et l'arbre doivent se consulter sur téléphone, la soumission peut rester desktop.
- ◐ **Recherche globale** (problèmes + articles) et palette de commandes (Ctrl+K).
- ◐ **Notifications** in-app + email opt-in (verdict, contest imminent, badge) ;
  **calendrier iCal** des contests à abonner.
- ◐ **Export PDF des énoncés** d'un contest (sessions papier façon ICPC).
- ◐ **Onboarding** : visite guidée à la première connexion (arbre → problème → soumission).
- ○ **Mode vim** et thèmes d'éditeur (Monaco le permet ; le club appréciera).

### 5.4 Communauté & contenu

- ★ **Bot/webhooks Discord** : annonces de contest, first bloods, problème de la
  semaine, badges rares. La plateforme vit là où le club discute déjà (Phase 2).
- ★ **« Signaler une erreur »** sur un énoncé/test → issue GitHub préremplie sur
  le dépôt de contenu — les correctifs suivent le flux normal (PR).
- ★ **Guide du contributeur de problèmes** + **CLI de validation** (`clubjudge-content
  validate`, cf. §3) : format, checklist qualité, process de relecture en PR avec CI.
- ◐ **Mode séance** : l'animateur compose une feuille d'exos, la projette, et voit
  en direct qui a résolu quoi et qui bloque où (heatmap des WA par test). La
  fonctionnalité « club » par excellence — ni Codeforces ni france-ioi ne l'ont.
- ◐ **Feuilles d'exercices** (sheets) : toute sélection ordonnée de problèmes,
  composable par les membres seniors, partageable par lien — sert les séances,
  les devoirs de prépa-contest et les parcours thématiques.
- ◐ **Page d'accueil vivante** : prochain contest, problème de la semaine,
  activité récente, derniers badges décernés.
- ◐ **Profils publics** : stats, heatmap, badges, problèmes résolus par catégorie.
- ◐ **Annonces/blog du club** (réutilise le pipeline d'articles de la Phase 3).
- ○ **API publique documentée** (FastAPI la donne presque gratuitement) — que les
  membres puissent coder leurs bots et outils est très dans l'esprit d'un club de code.

### 5.5 Admin & robustesse

- ★ **Dashboard admin minimal** : santé de Judge0, longueur de la file, derniers
  échecs d'import de contenu.
- ◐ **Détection de plagiat** sur les contests ([Dolos](https://dolos.ugent.be/),
  open source et moderne) — rapport pour les orgas, pas de sanction automatique.
- ◐ **Versionnage des problèmes** : modifier un test invalide marque les AC
  antérieurs « à rejuger » au lieu de réécrire l'histoire silencieusement.
- ◐ **Sauvegardes automatisées** de PostgreSQL + restauration testée.
- ◐ **Monitoring/alerting minimal** : uptime, longueur de file — alerte sur le
  Discord des orgas si la file s'empile ou si Judge0 ne répond plus.
- ◐ **RGPD de base** : export de ses données, suppression de compte — c'est une
  asso française avec des données d'étudiants.
- ○ **Métriques d'usage** anonymes : problèmes les plus abandonnés, taux de WA par
  test → signal pour améliorer énoncés et cours.

## 6. Direction artistique

Décision du 2026-06-12 : ClubJudge reprend l'identité visuelle du site vitrine
du club (`../clubcode.fr`, Astro statique) pour former un écosystème cohérent.
Le design system y est dans `src/styles/global.css` ; les fonts (woff2) et logos
(`logo.svg`, `mark.svg`, `logo_full.svg`) sont dans `public/`.

### Tokens à reprendre

| Token | Valeur |
|---|---|
| Fond | `#08080d` (`--bg`), surfaces `#0d0d15` (`--bg-raised`) |
| Texte | `#f4f2fa` (`--ink`), atténué `#b8b4c7`, discret `#807c92` |
| Accent | **lavande `#dcb7ff`** (`--lav`) + déclinaisons alpha 8/14/25 % pour fonds, bordures (`--line`) |
| Titres | **Clash Display** 500/600, line-height 1.08, letter-spacing −0.01em |
| Corps | **Satoshi** 400/500/700 |
| Mono | JetBrains Mono / ui-monospace — labels, code, données |
| Coins | **crantés** (clip-path, coin coupé 16px / 10px sur les boutons) — la signature de la marque, pas de border-radius |

### Idiomes visuels du site

- Panneaux à bordure 1px (fond `--line`, padding 1px, inner clip-path héritée),
  dégradé lavande au survol + léger translateY.
- Labels de section en mono uppercase, letter-spacing 0.22em, filet en dégradé.
- Numéros fantômes géants en outline (`-webkit-text-stroke` lavande à 8,5 %).
- Lueurs radiales lavande très subtiles (3-6 % d'opacité) en fond de section.
- Grain de film fixe (SVG turbulence, opacité 0.05) par-dessus tout.
- Animations « reveal » au scroll avec délais en cascade ; `prefers-reduced-motion` respecté partout.
- Sélection de texte inversée (fond lavande, texte sombre). Sombre uniquement.

### Adaptation à une application (vs. un site vitrine)

- **Partager les tokens, pas les écrans** : extraire un `tokens.css` commun
  (variables + @font-face) réutilisé par le site Astro et le front React, pour
  que les deux évoluent ensemble.
- Les pages **denses en données** (scoreboard, listes de soumissions, éditeur)
  gardent couleurs/fonts/coins crantés mais **calment les effets** : pas de
  grain ni de reveal sur les vues de travail, réservés aux pages d'accueil,
  de profil et de contest landing.
- Définir une **palette sémantique des verdicts** qui s'harmonise avec la
  lavande sur fond sombre : AC vert, WA rouge/rosé, TLE ambre, RE orangé,
  CE gris — à caler en Phase 1 et utiliser partout (liste, scoreboard, heatmap).
- L'arbre de compétences (§ Phase 1.5) est le terrain de jeu naturel de cette
  DA : nœuds hexagonaux crantés, branches en `--line`, nœuds maîtrisés en
  lavande pleine, lueur radiale au centre.
- Le site est déjà bilingue FR/EN (`src/i18n/`) — cohérent avec notre décision
  i18n ; reprendre la même approche de dictionnaires typés.

## 7. Points de vigilance

- **Sécurité du juge** : Judge0 doit être joignable *uniquement* par le backend
  (réseau Docker interne, jamais exposé). Ses workers ont besoin de privilèges
  cgroups — à vérifier sur le serveur de l'école (droits root/Docker requis).
- **Limites de ressources** : configurer Judge0 (temps, mémoire, nb de workers)
  pour qu'un contest avec ~30 participants ne mette pas la machine à genoux.
  Faire un test de charge avant le premier vrai contest.
- **Validation du contenu** : l'import doit refuser un problème dont la solution
  de référence ne passe pas les tests dans les limites — c'est le garde-fou
  qualité du dépôt de contenu.
- **Comparaison des sorties** : décider tôt de la politique (espaces/retours à la
  ligne finaux ignorés, comparaison token par token) et la documenter pour les
  auteurs de problèmes.
- **Sauvegardes** : dump PostgreSQL régulier dès que de vrais utilisateurs arrivent.
- **Latence Judge0** : une soumission = N tests = N appels Judge0. Utiliser les
  soumissions *batch* de son API et mesurer tôt le débit réel (combien de
  soumissions/minute la machine encaisse) — c'est ça qui dimensionne un contest.
- **Discipline de scope** : le catalogue (§5) est volontairement large ; le jalon
  de la phase en cours prime toujours sur une feature du catalogue. Une idée
  nouvelle se note dans le §5, elle ne s'implémente pas dans la foulée.
- **Bus factor** : le projet doit survivre au diplôme de son auteur. Concrètement :
  README d'exploitation à jour (déployer, restaurer, rejuger), architecture sans
  magie, et recruter/former un repreneur au club **au moins un an avant** de partir.

## 8. Conventions de travail

- Anglais pour le code et les identifiants, français pour le contenu (énoncés, articles) et la doc projet.
- Tests d'intégration sur le chemin critique (pipeline de soumission) avant toute nouvelle feature.
- Ce fichier `PLAN.md` est la source de vérité : toute décision structurante y est consignée.

## 9. Décisions ouvertes

Aucune — toutes tranchées le 2026-06-12 :

- **Framework front** : React + TypeScript + Vite. ✔
- **Auth** : sessions cookie (HttpOnly, SameSite), pas de JWT. ✔
- **Contenu** : dossier `content/` du monorepo ; extraction en dépôt séparé
  possible plus tard si des membres non-dev deviennent auteurs. ✔
- **Nom** : **ClubJudge**, définitif. ✔
