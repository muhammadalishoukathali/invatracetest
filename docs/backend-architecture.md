# Backend architecture and contracts

This implementation follows the Iteration 1 architecture: the installable PWA
is built by Vite and hosted on Cloudflare Pages; FastAPI and the verification
screening worker are independently deployable Render services; Neon provides
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
        worker["Screening Worker"]
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
    worker -->|"Claims jobs and writes rule decisions"| postgres
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

## Reporting and screening data model

```mermaid
erDiagram
    PROFILE ||--o{ REPORT : submits
    PROFILE ||--o{ UPLOAD_GRANT : requests
    SPECIES ||--o{ REPORT : identifies
    SPECIES ||--o{ SIGHTING : classifies
    REPORT ||--o{ REPORT_SIGHTING_LINK : links
    SIGHTING ||--o{ REPORT_SIGHTING_LINK : aggregates
    REPORT ||--o| VERIFICATION_JOB : queues
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
```

The migration contains the complete normalized schema, including monitored
areas/trails, legacy research tables, OVC-VI stream events/checkpoints, and spatial GiST
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

## Idempotent report and automated screening sequence

```mermaid
sequenceDiagram
    title Report upload and deterministic screening
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
    Worker->>PostgreSQL: Lock evidence, capture, and species units
    Worker->>Worker: Check JPEG quality and perceptual hashes
    Worker->>PostgreSQL: Apply versioned rules and audit decision
    Worker->>PostgreSQL: Publish sighting or link merged evidence
    PWA->>API: GET private report status
    API-->>PWA: Final automated state
```

## Public versus private screening visibility

Public sighting endpoints expose only rule-screened and removed sightings. Reports
remain private while processing, when a rescan is needed, when rejected, and
when required screening dependencies are unavailable. Coordinates contributed by `New`
profiles are deterministically displaced by about 100 metres and rounded to
four decimal places.

Exact byte or capture-ID replay is rejected. A multi-view difference hash also
detects resized images and common 80 percent crops. Reports that pass image
size, exposure, contrast, edge-detail, GPS, supported E1 version, and duplicate
rules are published with status `screened`. A report is merged when the same E1
species has a rule-screened sighting within the configured distance and time
window. The worker serializes matching content hashes, capture IDs, species,
and the bounded cross-species perceptual replay comparison before accepting a
candidate, so relabelling or racing a reused photo does not bypass the rule.

These rules do not determine whether a photo was taken from a screen or print,
and they do not detect sophisticated edits. The API explicitly returns
`authenticityAssessed: false`; authenticity classification is deferred to a
later iteration.

## API error and cache contract

Errors use `{ code, detail, requestId }`. Request validation failures are `400`, missing
or expired sessions are `401`, insufficient role is `403`, missing private
resources use non-enumerating `404` responses, conflicts use `409`, limits use
`429` plus `Retry-After`, and dependency failures use `503`.

Every response carries `X-Request-ID`, `X-Content-Type-Options: nosniff`, and
`Referrer-Policy: no-referrer`. Identity and authenticated responses carry
`Cache-Control: private, no-store` and `Pragma: no-cache`. Production responses
include HSTS; CORS origins are explicit and the wildcard is rejected at startup.
