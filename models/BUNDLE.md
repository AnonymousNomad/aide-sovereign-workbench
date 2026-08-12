# Full Offline Model Bundle

The release artifact `AIDE-model-bundle` contains the three public model files
listed in `manifest.json`, plus a machine-readable checksum manifest.

## Release Contract

- Weights are not committed to Git source history.
- Each file is downloaded from an official upstream or clearly attributed
  quantization repository.
- SHA-256 is checked before packaging and after extraction.
- The runtime must answer `/v1/models` and pass a local generation test before a
  pack becomes `ready`.
- A bundle can be installed without network access after it is downloaded.
- No unfinished project-specific checkpoint is included.

Run verification before publishing:

```bash
node scripts/verify-model-bundle.mjs
```
