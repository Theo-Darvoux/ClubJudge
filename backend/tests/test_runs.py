"""Exécution d'essai (« Exécuter sur les exemples » + entrée custom)."""

from app import submissions
from tests.conftest import register


def test_run_on_samples_returns_ac_when_output_matches(client, problem, fake_judge):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "print(5)"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Seuls les exemples sont exécutés, jamais les tests secrets.
    assert fake_judge.run_calls == [["2 3\n"]]
    assert len(body["cases"]) == 1
    case = body["cases"][0]
    assert case["verdict"] == "AC"
    assert case["input"] == "2 3\n"
    assert case["expected_output"] == "5\n"
    assert case["stdout"] == "5\n"


def test_run_on_samples_compares_output(client, problem, fake_judge):
    register(client)
    fake_judge.stdout = "999\n"
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "print(999)"},
    )
    assert resp.json()["cases"][0]["verdict"] == "WA"


def test_run_tolerates_trailing_whitespace(client, problem, fake_judge):
    register(client)
    fake_judge.stdout = "5 \n\n"
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "print(5)"},
    )
    assert resp.json()["cases"][0]["verdict"] == "AC"


def test_run_custom_input_skips_comparison(client, problem, fake_judge):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x", "custom_input": "7 8\n"},
    )
    assert resp.status_code == 200
    case = resp.json()["cases"][0]
    assert fake_judge.run_calls == [["7 8\n"]]
    assert case["expected_output"] is None
    assert case["verdict"] == "AC"  # exécution réussie, rien à comparer


def test_run_single_sample_by_index_is_compared(client, problem, fake_judge):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "print(5)", "sample_index": 0},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Seul l'exemple visé est exécuté, et le juge le compare (verdict AC/WA).
    assert fake_judge.run_calls == [["2 3\n"]]
    assert len(body["cases"]) == 1
    case = body["cases"][0]
    assert case["verdict"] == "AC"
    assert case["expected_output"] == "5\n"


def test_run_single_sample_wrong_answer(client, problem, fake_judge):
    register(client)
    fake_judge.stdout = "999\n"
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x", "sample_index": 0},
    )
    assert resp.json()["cases"][0]["verdict"] == "WA"


def test_run_sample_index_out_of_range(client, problem):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x", "sample_index": 9},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "sample_not_found"


def test_run_rejects_both_custom_and_sample_index(client, problem):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={
            "language": "python",
            "source_code": "x",
            "custom_input": "1\n",
            "sample_index": 0,
        },
    )
    assert resp.status_code == 422


def test_run_has_its_own_cooldown(client, problem):
    register(client)
    first = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x"},
    )
    assert first.status_code == 200
    second = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x"},
    )
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "cooldown"


def test_run_is_not_recorded_as_submission(client, problem):
    register(client)
    client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x"},
    )
    assert client.get("/api/problems/deux-sommes/submissions").json() == []
    assert client.get("/api/problems/deux-sommes").json()["attempted"] is False


def test_run_rejects_oversized_custom_input(client, problem):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={
            "language": "python",
            "source_code": "x",
            "custom_input": "a" * (submissions.MAX_CUSTOM_INPUT_BYTES + 1),
        },
    )
    assert resp.status_code == 413


def test_run_flags_truncated_output(client, problem, fake_judge):
    register(client)
    fake_judge.stdout = "x" * (submissions.MAX_RUN_OUTPUT_CHARS + 100)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x", "custom_input": "1\n"},
    )
    assert resp.status_code == 200
    case = resp.json()["cases"][0]
    assert case["truncated"] is True
    # La sortie est coupée, sans marqueur injecté dans le texte (qui fausserait le diff).
    assert len(case["stdout"]) == submissions.MAX_RUN_OUTPUT_CHARS


def test_run_flags_truncated_expected_output(client, problem, fake_judge):
    # L'attendu (comme l'entrée) est aussi borné pour le transport : aucun champ
    # texte n'est renvoyé sans limite. Le verdict reste calculé sur le texte complet.
    register(client)
    fake_judge.stdout = "y\n"
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={
            "language": "python",
            "source_code": "x",
            "custom_input": "z" * (submissions.MAX_RUN_OUTPUT_CHARS + 50),
        },
    )
    assert resp.status_code == 200
    case = resp.json()["cases"][0]
    assert case["truncated"] is True
    assert len(case["input"]) == submissions.MAX_RUN_OUTPUT_CHARS


def test_run_case_omits_memory(client, problem, fake_judge):
    # La mémoire n'est volontairement pas remontée pour un essai : l'affichage se
    # limite au verdict, au temps et aux E/S. On ne transporte pas de champ mort.
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "print(5)"},
    )
    assert resp.status_code == 200
    assert "memory_kb" not in resp.json()["cases"][0]


def test_run_success_carries_cooldown_header(client, problem):
    register(client)
    resp = client.post(
        "/api/problems/deux-sommes/run",
        json={"language": "python", "source_code": "x", "custom_input": "1\n"},
    )
    assert resp.status_code == 200
    # Le cooldown voyage dans un en-tête dédié (pas Retry-After, réservé aux 429).
    assert int(resp.headers[submissions.COOLDOWN_HEADER]) == int(submissions.RUN_COOLDOWN_S)
    assert "Retry-After" not in resp.headers
