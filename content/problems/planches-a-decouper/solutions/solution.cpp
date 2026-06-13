#include <algorithm>
#include <cstdio>
#include <vector>

int main() {
    int n;
    long long k;
    std::scanf("%d %lld", &n, &k);
    std::vector<long long> lengths(n);
    for (auto &l : lengths) std::scanf("%lld", &l);

    auto enough = [&](long long size) {
        long long pieces = 0;
        for (long long l : lengths) {
            pieces += l / size;
            if (pieces >= k) return true;
        }
        return false;
    };

    long long lo = 0, hi = *std::max_element(lengths.begin(), lengths.end());
    while (lo < hi) {
        long long mid = (lo + hi + 1) / 2;
        if (enough(mid)) lo = mid;
        else hi = mid - 1;
    }
    std::printf("%lld\n", lo);
}
