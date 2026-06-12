"""End-to-end judging against a live Judge0 (docker compose up judge0-server).

Run with: uv run pytest -m integration
"""

import pytest

from app.config import get_settings
from app.judge import Judge0Judge, Language, TestCase, Verdict

pytestmark = pytest.mark.integration

TESTS = [
    TestCase(input="2 3\n", expected_output="5\n"),
    TestCase(input="40 2\n", expected_output="42\n"),
]

CPP_AC = """\
#include <iostream>
int main() {
    long long a, b;
    std::cin >> a >> b;
    std::cout << a + b << "\\n";
}
"""

PYTHON_AC = """\
a, b = map(int, input().split())
print(a + b)
"""

PYTHON_WA = """\
a, b = map(int, input().split())
print(a - b)
"""

CPP_CE = "int main() { return 0 "


@pytest.fixture
def judge() -> Judge0Judge:
    return Judge0Judge(get_settings().judge0_url)


async def test_cpp_accepted(judge: Judge0Judge) -> None:
    result = await judge.submit(CPP_AC, Language.CPP, TESTS)
    assert result.verdict is Verdict.ACCEPTED
    assert len(result.tests) == len(TESTS)


async def test_python_accepted(judge: Judge0Judge) -> None:
    result = await judge.submit(PYTHON_AC, Language.PYTHON, TESTS)
    assert result.verdict is Verdict.ACCEPTED


async def test_python_wrong_answer(judge: Judge0Judge) -> None:
    result = await judge.submit(PYTHON_WA, Language.PYTHON, TESTS)
    assert result.verdict is Verdict.WRONG_ANSWER


async def test_cpp_compilation_error(judge: Judge0Judge) -> None:
    result = await judge.submit(CPP_CE, Language.CPP, TESTS)
    assert result.verdict is Verdict.COMPILATION_ERROR
    assert result.compile_output
