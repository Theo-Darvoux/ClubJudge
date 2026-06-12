input()
best = cur = None
for b in map(int, input().split()):
    cur = b if cur is None or cur < 0 else cur + b
    best = cur if best is None else max(best, cur)
print(best)
