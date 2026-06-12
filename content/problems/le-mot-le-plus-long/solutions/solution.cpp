#include <iostream>
#include <string>

int main() {
    std::string mot, champion;
    while (std::cin >> mot)
        if (mot.size() > champion.size()) champion = mot;
    std::cout << champion << '\n';
}
