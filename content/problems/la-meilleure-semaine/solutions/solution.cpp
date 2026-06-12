#include <algorithm>
#include <cstdio>

int main() {
    int n;
    std::scanf("%d", &n);
    long long best = -1e18, cur = 0;
    for (int i = 0; i < n; i++) {
        long long b;
        std::scanf("%lld", &b);
        cur = std::max(b, cur + b);
        best = std::max(best, cur);
    }
    std::printf("%lld\n", best);
}
