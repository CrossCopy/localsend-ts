FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src ./src
COPY tsconfig.json ./
# default command overridden by compose
CMD ["bun", "src/cli.ts", "--help"]
