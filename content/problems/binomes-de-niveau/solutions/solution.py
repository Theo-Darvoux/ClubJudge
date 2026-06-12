input()
v = sorted(map(int, input().split()))
print(min(b - a for a, b in zip(v, v[1:])))
