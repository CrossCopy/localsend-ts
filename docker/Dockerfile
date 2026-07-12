# Test/e2e image: a LocalSend-TS peer that runs the CLI (and can run the TUI)
# directly from source under Bun. Used by docker-compose to stand up two peers
# on a shared network for interop testing. Not a production/publish artifact.
FROM oven/bun:1
WORKDIR /app

# Install deps first for layer caching. Full (non-production) install because
# `bun src/cli.ts` runs from source and needs citty (a devDependency); it also
# pulls @opentui/* so the same image can run the TUI if you want to drive it.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source — no build step; Bun runs the .ts/.tsx entrypoints directly.
COPY src ./src
COPY tsconfig.json bunfig.toml ./

# Overridden by docker-compose per peer.
CMD ["bun", "src/cli.ts", "--help"]
