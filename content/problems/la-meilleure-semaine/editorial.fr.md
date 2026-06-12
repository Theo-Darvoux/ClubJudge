C'est le problème de la **sous-séquence contiguë de somme maximale**, et sa
solution en un seul passage est un grand classique : l'algorithme de
**Kadane**.

## L'idée

Plutôt que de chercher directement la meilleure période, on se pose une
question plus simple : pour chaque jour $i$, quelle est la meilleure période
qui se termine **exactement** au jour $i$ ? Appelons sa somme $c_i$.

Deux possibilités pour une période finissant au jour $i$ :

- elle prolonge la meilleure période finissant au jour $i-1$ : somme $c_{i-1} + b_i$ ;
- elle commence au jour $i$ : somme $b_i$.

Prolonger n'est intéressant que si $c_{i-1} > 0$ — un passé déficitaire ne
fait que plomber l'avenir. D'où la récurrence :

$$c_i = \max(b_i,\; c_{i-1} + b_i)$$

La réponse est $\max_i c_i$ : la meilleure période se termine forcément
*quelque part*.

```python
input()
best = cur = None
for b in map(int, input().split()):
    cur = b if cur is None or cur < 0 else cur + b
    best = cur if best is None else max(best, cur)
print(best)
```

Un seul passage, $O(n)$ en temps, $O(1)$ en mémoire : on n'a même pas besoin
de stocker le tableau.

## Le piège : la période vide

L'énoncé impose une période **non vide**. Si vous initialisez `cur` et `best`
à 0, le deuxième exemple (tous les bilans négatifs) renvoie 0 — la « période
vide » — au lieu de $-1$, le moins mauvais jour. C'est pour ça qu'on
initialise avec le premier bilan (ou `None` ci-dessus).

## Pour aller plus loin

Kadane est l'exemple d'école d'un raisonnement de **programmation dynamique** :
reformuler « la meilleure réponse » en « la meilleure réponse *qui se termine
ici* », que l'on sait calculer de proche en proche. Retenez ce réflexe, il
reviendra souvent. Variante à méditer : comment retrouver *les jours* de la
meilleure période, pas seulement sa somme ?
