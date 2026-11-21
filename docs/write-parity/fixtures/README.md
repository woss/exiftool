# Fixtures

Redistributable-only fixtures, one per vendor/model or container family
needed by a `docs/write-parity/matrix.json` cell. Name: `<fileType>-<family>.bin`
or `<vendor>-<model>-<family>.bin`.

- Licence-clean sources only (no camera-raw samples from unclear origins;
  synthetic or vendor-permitted files preferred).
- Every `fixture` value in `matrix.json` points here; a cell claiming
  `implemented` without a fixture where its spec requires one is rejected
  at review.
- Keep files minimal: smallest image that still exercises the cell.
