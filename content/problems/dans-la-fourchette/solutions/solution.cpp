#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n, q;
    std::scanf("%d %d", &n, &q);
    std::vector<long long> prices(n);
    for (auto &p : prices) std::scanf("%lld", &p);
    std::sort(prices.begin(), prices.end());
    for (int i = 0; i < q; i++) {
        long long a, b;
        std::scanf("%lld %lld", &a, &b);
        auto lo = std::lower_bound(prices.begin(), prices.end(), a);
        auto hi = std::upper_bound(prices.begin(), prices.end(), b);
        std::printf("%lld\n", (long long)(hi - lo));
    }
}
