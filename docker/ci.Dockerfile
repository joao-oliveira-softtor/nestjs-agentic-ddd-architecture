# Linux image for running the CI gate and the ub-mode tools (crapper, dryer, mutator) locally.
# The Bun version matches .github/workflows/ci.yml. Run it through `bun run ci:docker`.
FROM oven/bun:1.4.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv

ENV UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_PREFERENCE=only-system

ARG CRAPPER_REF=git+https://github.com/unclebob/crapper@6fd92c4c9bcc56efb64a2f8743d5a2993bcfd42d
ARG DRYER_REF=git+https://github.com/unclebob/dryer@66ff6d21a42c04afcad89c78a80066176d1294b0
ARG MUTATOR_REF=git+https://github.com/unclebob/mutator@a5a0cb803b66e0cdb8bf471b3b08af701d424a41
RUN uv tool install "$CRAPPER_REF" \
 && uv tool install "$DRYER_REF" \
 && uv tool install "$MUTATOR_REF" --with "$CRAPPER_REF" \
 && crapper --help >/dev/null && dryer --help >/dev/null && mutator --help >/dev/null

# Identity for the snapshot commit made inside the container.
RUN git config --global user.name ci-docker && git config --global user.email ci-docker@localhost \
 && git config --global init.defaultBranch main
WORKDIR /work
