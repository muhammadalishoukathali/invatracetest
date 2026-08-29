# Backend architecture and contracts

This implementation follows the Iteration 1 architecture: the installable PWA
is built by Vite and hosted on Cloudflare Pages; FastAPI and the verification
worker are independently deployable Render services; Neon provides
PostgreSQL/PostGIS; Cloudflare R2 provides private S3-compatible object storage.
Redis is the production rate-limit dependency. The browser ONNX adapter remains
client-side and is not moved into the API.

## Deployment topology

```mermaid
flowchart LR
    subgraph client ["Client Apps"]
        browser["InvaTrace PWA"]
    end
    subgraph gateway ["HTTPS and Static Delivery"]
        pages["Cloudflare Pages"]
        renderRoute["Render HTTPS Routing"]
    end
    subgraph service ["Application Services"]
        api["FastAPI Service"]
        worker["Verification Worker"]
    end
    subgraph datastore ["Managed Data"]
        postgres["Neon PostgreSQL and PostGIS"]
        redis["Redis Rate Limits"]
        r2["Cloudflare R2 Private Bucket"]
    end

    browser -->|"Loads PWA"| pages
    browser -->|"HTTPS API"| renderRoute
    renderRoute -->|"Routes requests"| api
    api -->|"Transactions and spatial queries"| postgres
    api -->|"Checks limits"| redis
    api -->|"Presigns and verifies photos"| r2
    worker -->|"Claims jobs and writes inference"| postgres
    worker -->|"Reads private photos"| r2
```

The Compose stack substitutes local PostGIS, Redis, and MinIO while preserving
the same protocols and process boundaries.

## Identity data model

```mermaid
erDiagram
    PROFILE ||--o{ INSTALLATION : authorizes
    PROFILE ||--o{ RECOVERY_BATCH : owns
    RECOVERY_BATCH ||--|{ RECOVERY_CODE : contains
    PROFILE ||--o{ AUDIT_EVENT : acts_in

    PROFILE {
        uuid id PK
        string public_id UK
        string display_name
        string role
        string trust_level
        bool recovery_setup_acknowledged
    }
    INSTALLATION {
        uuid id PK
        uuid profile_id FK
        bytes token_hash UK
        datetime last_used_at
        datetime revoked_at
    }
    RECOVERY_BATCH {
        uuid id PK
        uuid profile_id FK
        datetime created_at
        datetime invalidated_at
    }
    RECOVERY_CODE {
        uuid id PK
        uuid batch_id FK
        uuid profile_id FK
        bytes code_hash
        datetime used_at
    }
    AUDIT_EVENT {
        uuid id PK
        uuid acting_profile_id FK
        string event_type
        string subject_id
        datetime created_at
    }
```

## Reporting and verification data model

```mermaid
erDiagram
    PROFILE ||--o{ REPORT : submits
    PROFILE ||--o{ UPLOAD_GRANT : requests
    SPECIES ||--o{ REPORT : identifies
    SPECIES ||--o{ SIGHTING : classifies
    REPORT ||--o{ REPORT_SIGHTING_LINK : links
    SIGHTING ||--o{ REPORT_SIGHTING_LINK : aggregates
    REPORT ||--o| VERIFICATION_JOB : queues
    REPORT ||--o{ INFERENCE_RECORD : receives
    REPORT ||--o{ AUTOMATED_VALIDATION_DECISION : records
    PROFILE ||--o{ NOTIFICATION : receives
    PROFILE ||--o{ IDEMPOTENCY_RECORD : owns

    REPORT {
        uuid id PK
        uuid profile_id FK
        string species_id FK
        string status
        string photo_key UK
        geography location
        string idempotency_key
    }
    SIGHTING {
        uuid id PK
        string species_id FK
        string status
        geography location
        uuid merged_into_sighting_id FK
    }
    REPORT_SIGHTING_LINK {
        uuid id PK
        uuid report_id FK
        uuid sighting_id FK
        bool active
    }
    VERIFICATION_JOB {
        uuid id PK
        uuid report_id FK
        string status
        int attempts
        datetime available_at
    }
    AUTOMATED_VALIDATION_DECISION {
        uuid id PK
        uuid report_id FK
        string decision
        uuid merge_target_id FK
        string policy_version
        json reason_codes
    }
    INFERENCE_RECORD {
        uuid id PK
        uuid report_id FK
        uuid model_version_id FK
        string status
        json identification_json
        json embedding_json
    }
```

The migration contains the complete normalized schema, including monitored
areas/trails, model versions, OVC-VI stream events/checkpoints, and spatial GiST
indexes. The diagrams intentionally show the central bounded contexts rather
than every column.

## Private access restore sequence

```mermaid
sequenceDiagram
    title One-time recovery restore
    participant PWA
    participant API
    participant Redis
    participant PostgreSQL

    PWA->>API: POST /profiles/restore
    API->>Redis: Check restore limit
    Redis-->>API: Allowed
    API->>PostgreSQL: Lock profile and active codes
    PostgreSQL-->>API: HMAC values
    API->>PostgreSQL: Consume code and add installation
    API->>PostgreSQL: Append audit event
    PostgreSQL-->>API: Commit
    API-->>PWA: Access token and profile
```

Invalid profile IDs and recovery codes produce the same response. The raw code
is never stored, logged, or returned again.

## Idempotent report and automated validation sequence

```mermaid
sequenceDiagram
    title Report upload and verification
    participant PWA
    participant API
    participant ObjectStore
    participant PostgreSQL
    participant Worker

    PWA->>API: POST /uploads/presign
    API->>PostgreSQL: Lock idempotency key
    API-->>PWA: Signed PUT URL
    PWA->>ObjectStore: PUT JPEG
    PWA->>API: POST /reports
    API->>ObjectStore: HEAD exact object
    API->>ObjectStore: Copy to immutable evidence key
    API->>PostgreSQL: Insert private processing report and job
    API-->>PWA: 201 processing report plus tracking URL
    Worker->>PostgreSQL: Claim job with SKIP LOCKED
    Worker->>ObjectStore: GET private JPEG
    Worker->>PostgreSQL: Lock evidence hash and store inference
    Worker->>PostgreSQL: Apply versioned policy and audit decision
    Worker->>PostgreSQL: Publish sighting or link merged evidence
    PWA->>API: GET private report status
    API-->>PWA: Final automated state
```

## Public versus private validation visibility

Public sighting endpoints expose only confirmed and removed sightings. Reports
remain private while processing, when a rescan is needed, when rejected, and
when the server validator is unavailable. Coordinates contributed by `New`
profiles are deterministically displaced by about 100 metres and rounded to
four decimal places.

Automated merging requires the independently identified same species, a nearby
confirmed sighting within at most 50 metres, and a model-embedding cosine match.
Exact image or capture replay is rejected. The worker serializes matching
content hashes and capture IDs before replay checks, then serializes each
server-identified species while checking spatial merge candidates.

## API error and cache contract

Errors use `{ code, detail, requestId }`. Validation failures are `400`, missing
or expired sessions are `401`, insufficient role is `403`, missing private
resources use non-enumerating `404` responses, conflicts use `409`, limits use
`429` plus `Retry-After`, and dependency failures use `503`.

Every response carries `X-Request-ID`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`. Identity and authenticated responses carry
`Cache-Control: private, no-store` and `Pragma: no-cache`. Production responses
include HSTS; CORS origins are explicit and the wildcard is rejected at startup.
