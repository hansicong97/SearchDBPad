# ADR 0001: adapter manifests and optional capabilities

## Decision

SearchDBPad uses an engine-neutral adapter registry. Every adapter publishes a manifest containing its protocol family, resource model, query languages, transfer formats, supported versions, and capabilities. Operations are optional methods on the adapter contract and are selected through capability-aware helpers.

## Rationale

Elasticsearch, OpenSearch, and Solr expose different request and resource models. A large mandatory interface would force unsupported operations onto every engine and cause the renderer to discover support by failed requests. Manifest-driven checks allow services and UI code to reject unsupported actions before network calls while keeping engine-specific behavior inside adapters.

## Consequences

Adding an engine requires a manifest, adapter contract tests, compatibility notes, and explicit renderer behavior for unsupported capabilities. Existing persisted connections without an engine type continue to resolve as Elasticsearch.
