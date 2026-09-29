FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src src
RUN uv sync --frozen --no-dev
EXPOSE 8001
CMD ["uv", "run", "--no-sync", "uvicorn", "science.main:app", "--host", "0.0.0.0", "--port", "8001"]
