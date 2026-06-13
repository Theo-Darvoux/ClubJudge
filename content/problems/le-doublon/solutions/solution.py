input()
seen = set()
for x in map(int, input().split()):
    if x in seen:
        print(x)
        break
    seen.add(x)
else:
    print(-1)
