#include <cstdio>
#include <unordered_set>

int main() {
    int n;
    std::scanf("%d", &n);
    std::unordered_set<long long> seen;
    seen.reserve(2 * n);
    for (int i = 0; i < n; i++) {
        long long a;
        std::scanf("%lld", &a);
        if (seen.count(a)) {
            std::printf("%lld\n", a);
            return 0;
        }
        seen.insert(a);
    }
    std::printf("-1\n");
}
