# Murmur API Reference

Four separate OpenAPI 3.1 specs document the four HTTP contracts in this system.
Each has a different audience, auth model, and network reachability — so they live
in separate files rather than behind a shared server dropdown.

## Which spec do I want?

| Spec | File | Audience | Base URL | Auth |
|---|---|---|---|---|
| **BFF** (`/api/*`) | [`nuxt-openapi.yaml`](./nuxt-openapi.yaml) | Browser clients — the Nuxt app, or any third-party frontend | `https://{MURMUR_HOST}:{MURMUR_PORT}` (via Caddy) | `murmur_token` JWT httpOnly cookie; auth endpoints rate-limited at the orchestrator; `/api/extract-url` enforces an SSRF allow-list |
| **Orchestrator** | [`orchestrator-openapi.yaml`](./orchestrator-openapi.yaml) | BFF developers, operators, and anyone wiring a non-Nuxt client (e.g. a native mobile app) | `http://orchestrator:8000` (Compose network) or `http://localhost:8000` (dev) | `X-User-Id: <int>` header, injected by the BFF after cookie validation |
| **TTS Engine** | [`tts-engine-openapi.yaml`](./tts-engine-openapi.yaml) | Engine implementors (writing a sixth engine) and anyone calling an engine directly for debugging | `http://localhost:8100` (the single active engine) | None — loopback-only |
| **Alignment** | [`alignment-openapi.yaml`](./alignment-openapi.yaml) | Orchestrator internals; optional service gated behind the `full` Compose profile | `http://align:8001` (Compose) or `http://localhost:8001` (dev) | None — loopback-only |

## How the layers connect

```
Browser
   │  HTTPS, Cookie: murmur_token=...
   ▼
Caddy  ──(TLS termination)──▶  Nuxt BFF
                                   │  HTTP, X-User-Id: 42
                                   ▼
                               Orchestrator (port 8000)
                                 │       │
                                 │       └──▶ Alignment server (port 8001, optional)
                                 ▼
                             Active TTS engine (port 8100)
```

Every browser request flows through Caddy → Nuxt → Orchestrator → optionally the
active TTS engine. The orchestrator additionally calls the alignment server per
generated segment when it's running (`--profile full`). Each hop translates auth:
the cookie becomes a header becomes nothing. Each boundary is documented by the
matching spec.

## Conventions used across all four specs

- **OpenAPI 3.1.0.** `type: [string, "null"]` is preferred over deprecated `nullable: true`.
- **Advisory enums.** Where Pydantic models use a bare `str` (e.g. `JobResponse.status`,
  `BackendResponse.status`), the spec documents the value as `type: string` with a
  description listing known values — not as a strict `enum`. Strict-enum schemas
  (`JobStatus`, `EngineStatus`) are provided in `components/schemas` as opt-in
  narrowings for client-side typing.
- **SSE `data:` field is a JSON-encoded string**, not an inline object. Clients must
  `JSON.parse(event.data)`. The `JobEvent` / `BackendStatusEvent` schemas describe
  the parsed shape.
- **No fabricated constraints.** `minLength`, `pattern`, etc. appear only where the
  Pydantic model actually enforces them (which, at time of writing, is nowhere).
- **Shared schemas are duplicated between BFF and orchestrator specs.** Since the
  two services have independent consumers, the specs are standalone; changes to
  `orchestrator/models.py` must be mirrored to both files.

## Viewing / validating locally

```bash
# Lint each spec:
npx @redocly/cli lint docs/api/nuxt-openapi.yaml
npx @redocly/cli lint docs/api/orchestrator-openapi.yaml
npx @redocly/cli lint docs/api/tts-engine-openapi.yaml
npx @redocly/cli lint docs/api/alignment-openapi.yaml

# Preview as HTML:
npx @redocly/cli preview-docs docs/api/nuxt-openapi.yaml
```

Any tool that reads OpenAPI 3.1 (Swagger UI, Redoc, Stoplight, Postman, Bruno)
will render them — point it at whichever spec matches the service you're calling.
