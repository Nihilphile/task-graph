# Fixtures

Fixtures used by the Task Graph test suite.

- `golden/` — deterministic expected build output (for example `graph.json`
  projections and HTML fingerprints) compared against a freshly built project.
  Golden files are regenerated only through an explicit update command so the
  repository never drifts silently.

Fixtures are read-only inputs for tests. Tests never write here; they copy what
they need into an isolated temporary directory (`tests/helpers/temp.ts`) and
mutate the copy.
