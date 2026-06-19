# HayInsights Open API — OpenAPI Specification

The official OpenAPI 3.1 specification for the **HayInsights Open API** — the
**single source of truth** for the public API surface, shared by SDK codegen,
the reference docs, and (later) the mock server / contract tests.

[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.1-blue)](https://spec.openapis.org/oas/v3.1.0)
[![Version](https://img.shields.io/badge/version-0.1.0-orange)](./package.json)
[![License](https://img.shields.io/badge/license-Proprietary-lightgrey)](#license)

---

## Quick start

```bash
npm install
npm run lint        # must pass with 0 errors
npm run bundle      # emits dist/openapi.yaml and dist/openapi.json
npm run preview     # open the Redoc preview in a browser

npm i -g mint       # one-time: install the Mintlify CLI (https://mintlify.com/docs)
npm run docs:dev    # run the docs site locally → http://localhost:3000
npm run docs:validate  # strict build check (no server)
```

`npm run lint` is the gatekeeper — the rules in `redocly.yaml` are all set to
`error` and fail the build on violation.

---

## Project structure

```
openapi/
├── openapi.yaml            # Root entrypoint (info, servers, security, tags, paths)
├── paths/                  # One YAML file per URL path, grouped by tag
└── components/
    ├── securitySchemes/    # 1 apiKey scheme — X-API-Key
    ├── parameters/         # Reusable path / query parameters
    ├── responses/          # Reusable 4xx / 5xx error responses
    ├── headers/            # Reusable response headers (X-RateLimit-*)
    └── schemas/
        ├── common/         # EnvelopeBase, ErrorBody, Meta + enums
        ├── commodities/    # Domain data schemas
        ├── crypto/
        ├── etf/
        ├── fx/
        ├── macro/
        ├── realestate/
        └── responses/      # One response wrapper per operation
docs/                       # Mintlify docs site
dist/                       # Bundle output (gitignored)
```

---

## Authentication

The API has a **single authentication tier**: send your API key in the
`X-API-Key` header on every request to `/openapi/v1/*`. There is no request
signing.

| Header      | When   | Value                              |
| ----------- | ------ | ---------------------------------- |
| `X-API-Key` | Always | Your API key (prefixed `apk_`)     |

Which data domains you can access and your request quota are both governed by
the **subscription plan** attached to the key. Each endpoint consumes a
**weighted** amount of your per-minute quota; every response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and
`X-RateLimit-Weight-Used` headers.

---

## Response envelope

Every response is wrapped in a standard envelope:

```json
{ "success": true, "statusCode": 200, "data": { }, "meta": { "timestamp": "2026-06-19T08:31:59.478Z" } }
```

Errors use:

```json
{ "success": false, "statusCode": 401, "error": { "code": "API_KEY_INVALID", "message": "Invalid API key" }, "meta": { "timestamp": "..." } }
```

---

## Regenerating examples

The `example:` blocks in the spec are harvested from the live API:

```bash
HAYINSIGHTS_API_KEY=apk_xxx npm run harvest   # writes examples/<operationId>.json
```

The API key is read from the environment only — never commit it.

---

## License

Proprietary. © HayInsights. All rights reserved.
