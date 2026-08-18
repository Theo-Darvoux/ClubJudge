FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# Serveurs de langage de l'éditeur, proxifiés en WebSocket par app/lsp.py :
#   - clangd   : IntelliSense C/C++ (g++ fournit les en-têtes libstdc++, dont
#                <bits/stdc++.h>, que clangd analyse).
#   - ocamllsp : IntelliSense OCaml (ocaml-lsp-server ; ocaml apporte la
#                bibliothèque standard que merlin résout pour la complétion).
RUN apt-get update \
    && apt-get install -y --no-install-recommends clangd g++ ocaml ocaml-lsp-server \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

# Le backend lance aussi les processus LSP : ils ne doivent jamais hériter de
# privilèges root dans le conteneur.
RUN useradd --create-home --uid 10001 clubjudge \
    && chown -R clubjudge:clubjudge /app
USER clubjudge
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "fastapi", "run", "app/main.py", "--port", "8000"]
