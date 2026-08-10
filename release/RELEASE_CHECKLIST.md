# AIDE Release Preflight

- [ ] Build and smoke-test the offline UI.
- [ ] Confirm `models/manifest.json` loads without network access.
- [ ] Confirm TinyLiquid artifact exists and matches its recorded SHA-256.
- [ ] Load TinyLiquid through the declared local adapter and record the response.
- [ ] Install a coding-tuned checkpoint and replace the pending builder manifest entry.
- [ ] Run coding probes and record real results in the coding model card.
- [ ] Verify patch preview, approval, undo, cancellation, and test gates.
- [ ] Verify no credentials, prompts, logs, or private source files are in the release folder.
- [ ] Confirm every model license and attribution.
- [ ] Generate a signed `package-manifest.json` release artifact.
- [ ] Publish only after owner approval.
