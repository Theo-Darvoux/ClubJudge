---
practice:
  - le-mot-le-plus-long
---

# La complexité, sans les maths

Votre programme est correct sur les exemples mais le juge répond « Temps
dépassé » ? Bienvenue dans la vraie discipline de la programmation
compétitive : estimer **avant de coder** si une idée tiendra dans la limite
de temps.

## Compter les opérations

La notation $O(\cdot)$ répond à une question simple : *quand l'entrée
grossit, combien d'opérations mon programme fait-il, en gros ?* On ignore
les constantes et on garde le terme dominant.

```python
total = 0
for x in valeurs:        # n tours
    total += x           # O(n) au total
```

```python
for i in range(n):       # n tours
    for j in range(n):   # n tours chacun
        ...              # O(n²) au total
```

Règle pratique à mémoriser : **un juge encaisse environ $10^8$ opérations
simples par seconde** (ordre de grandeur). Avec une limite de 1 à 2 secondes :

| $n$ maximal de l'énoncé | Complexité visée |
|---|---|
| $n \le 100$ | $O(n^3)$ passe |
| $n \le 5\,000$ | $O(n^2)$ passe |
| $n \le 10^5$ – $10^6$ | $O(n \log n)$ ou $O(n)$ |
| $n \le 10^{18}$ | $O(\log n)$ ou $O(1)$ — il y a une formule |

Lisez les bornes de l'énoncé **avant** de réfléchir : elles vous disent
presque quelle famille de solution est attendue.

## Un exemple qui change tout

« Trouvez la tranche de jours consécutifs dont la somme est maximale. »
L'approche naïve essaie toutes les tranches : deux boucles, $O(n^2)$.
Pour $n = 10^5$, c'est $10^{10}$ opérations — plusieurs minutes, refusé.

L'observation qui sauve : en parcourant les jours une seule fois, il suffit
de connaître *la meilleure tranche qui se termine ici* pour en déduire la
suivante. Soit $m_i$ le maximum d'une tranche se terminant au jour $i$ :

$$m_i = \max(v_i,\; m_{i-1} + v_i)$$

Une passe, $O(n)$ : c'est l'algorithme de Kadane, votre premier algorithme
« célèbre ». Le TP ci-dessous vous le fait redécouvrir — essayez d'abord
sans relire la formule.

```tp
la-meilleure-semaine
```

## Ce qu'il faut retenir

- Les bornes de l'énoncé dictent la complexité attendue — lisez-les d'abord.
- $10^8$ opérations simples ≈ 1 seconde : faites le produit des boucles.
- Un « Temps dépassé » n'est presque jamais un problème de micro-optimisation :
  c'est l'algorithme qu'il faut changer, pas le code qu'il faut resserrer.
