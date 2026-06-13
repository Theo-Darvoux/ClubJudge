Vous planifiez un sprint de préparation au concours : le calendrier du club
prévoit $n$ jours d'affilée, et l'exercice du jour $i$ demande $e_i$ unités
d'énergie. Votre réserve totale est de $B$ unités, et un sprint doit couvrir
des jours **consécutifs** — pas question de sauter le jour difficile au
milieu. Combien de jours peut durer votre plus long sprint ?

## Entrée

- La première ligne contient deux entiers $n$ et $B$
  ($1 \le n \le 2 \times 10^5$, $0 \le B \le 10^{14}$), le nombre de jours
  et le budget d'énergie.
- La deuxième ligne contient $n$ entiers $e_1, \dots, e_n$
  ($0 \le e_i \le 10^9$), l'énergie demandée chaque jour.

## Sortie

La longueur maximale d'une suite de jours consécutifs dont l'énergie totale
ne dépasse pas $B$. Si même un seul jour coûte trop cher partout, affichez
$0$.

## Exemples

### Entrée

```
7 8
2 3 1 2 4 3 0
```

### Sortie

```
4
```

Les jours $1$ à $4$ coûtent $2 + 3 + 1 + 2 = 8 \le 8$ : un sprint de $4$
jours. Aucune fenêtre de $5$ jours ne tient dans le budget.

### Entrée

```
3 1
5 9 2
```

### Sortie

```
0
```
