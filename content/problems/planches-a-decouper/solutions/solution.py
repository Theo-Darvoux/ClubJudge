import sys

data = sys.stdin.buffer.read().split()
k = int(data[1])
lengths = list(map(int, data[2:]))


def enough(size: int) -> bool:
    return sum(length // size for length in lengths) >= k


lo, hi = 0, max(lengths)  # invariant : enough(lo) vrai (lo=0 par convention), enough(hi+1) faux
while lo < hi:
    mid = (lo + hi + 1) // 2
    if enough(mid):
        lo = mid
    else:
        hi = mid - 1
print(lo)
