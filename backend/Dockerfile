FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

# clangd : IntelliSense C/C++ de l'éditeur (proxifié en WebSocket par app/lsp.py).
# g++ fournit les en-têtes libstdc++ (dont <bits/stdc++.h>) que clangd analyse.
RUN apt-get update \
    && apt-get install -y --no-install-recommends clangd g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

EXPOSE 8000
CMD ["uv", "run", "--no-dev", "fastapi", "run", "app/main.py", "--port", "8000"]
