Le rituel d'initiation : ce problème ne teste pas votre algorithmique, mais
votre maîtrise des **entrées/sorties**, le premier réflexe à acquérir sur un
juge en ligne.

## La solution

1. Lire la ligne et la découper en deux entiers.
2. Les additionner.
3. Afficher le résultat.

En Python :

```python
a, b = map(int, input().split())
print(a + b)
```

En C++ :

```cpp
#include <iostream>

int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << "\n";
}
```

## Les deux pièges classiques

- **Oublier la conversion en entier** (Python) : `input().split()` renvoie des
  chaînes, et `"2" + "3"` vaut `"23"`.
- **Le débordement** (C/C++) : $a + b$ peut atteindre $2 \times 10^9$, à un
  cheveu de la limite d'un `int` 32 bits ($2^{31}-1 \approx 2{,}15 \times 10^9$).
  Ici ça passe, mais c'est le bon moment pour prendre le réflexe `long long`
  dès que les valeurs dépassent le million : la moitié des WA mystérieux du
  club viennent de là.
