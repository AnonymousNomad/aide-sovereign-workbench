# AIDE Journal Desk

The Journal Desk is the first journalism workflow in the IDE. It works without a model or network connection.

## Local CaseFile Flow

1. Create a CaseFile with a private boundary.
2. Import local text evidence.
3. Compute a SHA-256 receipt for every file.
4. Extract date anchors for timeline work.
5. Preserve the provenance record before sending selected evidence to a model.
6. Later run the evidence through source-DNA, timeline, discrepancy, pattern, and editorial-review tools.

The browser prototype stores only the case metadata, hashes, and date anchors in local storage. It does not upload evidence. The production daemon will store encrypted CaseFiles outside the browser and will require an explicit boundary change before group or public replication.

This is not a truth guarantee. A hash proves which bytes were reviewed, not that the document is authentic or that its claims are true. Authenticity requires provenance, corroboration, signatures, and human judgment.
