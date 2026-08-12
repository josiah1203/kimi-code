# Commercial workspace rules

This workspace contains SpiderByte hosted and paid-product code. It is not part
of the Open Core package set.

- Commercial packages may depend on neutral Open Core contracts and explicit
  data-plane adapter ports. Open Core packages must never import commercial
  packages or hosted identity, billing, entitlement, or tenant implementation.
- Domain packages are pure: no filesystem, network, process, payment, identity,
  queue, object-store, or database calls.
- Application services enforce authorization, entitlement, idempotency, and
  audit behavior centrally. API handlers must not duplicate those decisions.
- Secrets are accepted only at adapter boundaries and are never persisted in
  ordinary domain records, logs, metadata, or audit payloads.
- Production integrations must report `not_configured`, `temporarily_unavailable`,
  or `not_implemented` and fail closed until their adapter is verified.
- Deterministic adapters are for tests and local development only. They must be
  selected explicitly and must not be silently enabled in production mode.
- Add or update domain tests in the existing package test file where possible;
  every mutation needs idempotency and authorization coverage.
