# Compatibility matrix

| Adapter | Protocol family | Server versions | Query language | Import formats | Export formats |
|---|---|---|---|---|---|
| Elasticsearch | `elasticsearch-rest` | 6.x, 7.x, 8.x, 9.x | Elasticsearch DSL | JSON, NDJSON, CSV | JSON, NDJSON, CSV |
| OpenSearch | `elasticsearch-rest` | 1.x, 2.x | Elasticsearch DSL | JSON, NDJSON, CSV | JSON, NDJSON, CSV |
| Solr | `solr-rest` | 8, 9 | Solr parameters (`q`, `fq`, `sort`, `start`, `rows`) | JSON, CSV | JSON, CSV |

The manifest is the source of truth at runtime. A format or query language absent from the manifest is rejected before network or output creation. Solr CSV preserves fields returned by Solr, including its configured unique key, and does not synthesize an Elasticsearch `_id` column.

Current evidence is deterministic adapter/contract fixtures. Live server verification is still a release gate: run representative Elasticsearch 6.x–9.x, OpenSearch 1.x/2.x, and Solr 8/9 checks before claiming server compatibility. Electron UI checks are a separate gate.
