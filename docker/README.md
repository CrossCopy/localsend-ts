# Docker: two-peer multicast discovery

This directory contains a Docker image and Compose setup that runs two
`localsend-ts` CLI instances (`PeerA` and `PeerB`) as separate containers on
a shared user-defined bridge network (`lsnet`).

## Why this exists

LocalSend's discovery mechanism relies on UDP multicast. On a single host,
tests that spin up two `receive` processes in the same network namespace
(e.g. two Bun processes on `localhost`) can exercise the multicast code
paths, but they don't prove that multicast actually crosses a real network
boundary. Running each peer in its own container, on its own network
namespace, connected only by a Docker bridge network, is a much closer
approximation of two machines on the same LAN — so it's a good way to
smoke-test that multicast discovery genuinely works over the wire.

## What's here

- `Dockerfile` — builds a Bun-based image containing the `localsend-ts`
  source and **all** dependencies, including `devDependencies` (the CLI's
  `src/cli.ts` imports `citty`, which is a devDependency — `bun install
--frozen-lockfile` installs it by default, so do not add `--production`
  or `NODE_ENV=production` to the install step).
- `docker-compose.yml` — defines two services, `peer-a` and `peer-b`, both
  built from the same image and both running `bun src/cli.ts receive` with
  `--autoAccept --verbose`, joined to a shared bridge network `lsnet`.

## Running manually

From the repo root:

```bash
docker compose -f docker/docker-compose.yml up --build
```

This builds the image (first run only, or whenever `src/`, `package.json`,
or `bun.lock` change) and starts both peers. Watch the logs — with
`--verbose`, each peer prints `Device discovered: <alias>` when it sees the
other peer's multicast announcement, e.g. `PeerA` logging
`Device discovered: PeerB` and vice versa.

Stop and clean up with:

```bash
docker compose -f docker/docker-compose.yml down -v
```

To just build without starting:

```bash
docker compose -f docker/docker-compose.yml build
```

## macOS caveat

Docker Desktop on macOS runs containers inside a Linux VM. **Container ↔
container** multicast (what this compose file exercises, via the `lsnet`
bridge network) works fine inside that VM, because both containers share
the VM's virtual network stack.

**Host ↔ container** multicast does _not_ generally work on macOS — a
`localsend-ts receive` process running directly on the macOS host will not
see multicast announcements from a container (and vice versa), because the
VM boundary does not forward multicast traffic transparently. Docker's
`--network host` mode is also unsupported on macOS (it's a Linux-only
feature; Docker Desktop silently falls back to bridge networking), so it
cannot be used as a workaround to put a container on the host's network
segment. If you need to test host ↔ real-machine discovery, run one peer
on the Mac host directly and the other on a genuinely separate physical
(or virtual) machine on the same LAN, or run both peers as containers as
this compose file does.
