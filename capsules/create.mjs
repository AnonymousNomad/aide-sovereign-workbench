import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

const output = process.argv[2] || 'aide-capsule.json';
const capsule = {
  schema_version: '1.0',
  capsule_id: `aide-${crypto.randomUUID()}`,
  created_at: new Date().toISOString(),
  privacy: 'metadata-only',
  workspace: { root_label: process.env.AIDE_WORKSPACE_LABEL || 'local-workspace', git_revision: process.env.AIDE_GIT_REVISION || 'not-recorded' },
  model: { id: process.env.AIDE_MODEL_ID || 'not-recorded', revision: process.env.AIDE_MODEL_REVISION || 'not-recorded', runtime: process.env.AIDE_MODEL_RUNTIME || 'not-recorded', quantization: process.env.AIDE_MODEL_QUANTIZATION || 'not-recorded' },
  evidence: [],
  verification: { checks: {}, status: 'unverified' },
  tools: [],
  notes: 'Metadata only. Source and evidence bytes are not included.'
};
await fs.writeFile(output, `${JSON.stringify(capsule, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(`created ${output}`);
