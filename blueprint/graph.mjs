const layers = [
  { id: 'source', label: 'SOURCE', color: '#58c7ff' },
  { id: 'data', label: 'DATA', color: '#b277ff' },
  { id: 'build', label: 'BUILD', color: '#72ff9e' },
  { id: 'verify', label: 'VERIFY', color: '#ffc76b' },
  { id: 'release', label: 'RELEASE', color: '#ff5fcf' },
  { id: 'model-pack', label: 'MODEL PACK', color: '#96ffa7' }
];

export function buildBlueprint({ entries = [], models = [], training = {} } = {}) {
  const nodes = [];
  const edges = [];
  const add = (id, label, layer, status, detail, x, y, z) => nodes.push({ id, label, layer, status, detail, x, y, z });
  const link = (source, target, relation) => edges.push({ source, target, relation });

  add('workspace', 'WORKSPACE', 'source', 'active', 'Local project boundary', 0, 0, 0);
  const files = entries.filter(entry => entry.kind === 'file').slice(0, 12);
  files.forEach((entry, index) => {
    const id = `file:${entry.name}`;
    add(id, entry.name, 'source', 'ready', 'Workspace file', -2.4 + (index % 4) * 1.6, 1.2 + Math.floor(index / 4) * 1.2, 0.2);
    link('workspace', id, 'contains');
  });
  add('dataset', 'DATASET', 'data', 'ready', 'Local training and evidence inputs', -1.8, 0, 1.8);
  add('tokenizer', 'TOKENIZER', 'data', 'ready', 'Tokenization boundary', 0, 1.3, 1.8);
  link('workspace', 'dataset', 'feeds');
  link('dataset', 'tokenizer', 'encodes');

  add('architecture', 'ARCHITECTURE', 'build', 'ready', 'Model graph and runtime contract', 1.8, 0, 3.6);
  add('training', 'TRAINING RUN', 'build', training.active ? 'active' : 'idle', training.active ? `Running ${training.active.id}` : 'No active local job', 0, -1.3, 3.6);
  link('tokenizer', 'architecture', 'configures');
  link('architecture', 'training', 'trains');

  // Model pack nodes - show available/local models
  models.slice(0, 8).forEach((model, index) => {
    const id = `model:${model.id}`;
    const status = model.status === 'pending' ? (model.artifact_available ? 'ready' : 'pending') : model.status;
    const detail = model.artifact_available
      ? `${model.format || 'local'} | ${model.lane || 'model'} lane (ready)`
      : `${model.format || 'local'} | ${model.lane || 'model'} lane (pending download)`;
    add(id, model.name || model.id, 'release', status, detail, 1.1 + (index % 3) * 1.6, -1.6 + Math.floor(index / 3) * 1.1, 3.2);
    link('training', id, 'produces');
  });

  add('veritas', 'VERITAS GATE', 'verify', 'blocked', 'Tests, diff, secrets, and approval checks', 0, 0, 5.4);
  add('evaluation', 'EVALUATION', 'verify', 'pending', 'Held-out quality and capability checks', 1.9, 1.2, 5.4);
  link('training', 'veritas', 'checks');
  link('training', 'evaluation', 'measures');
  add('model-pack', 'MODEL PACK', 'release', 'pending', 'Export, checksum, and model card', 0.8, 0, 7.2);
  add('release', 'RELEASE', 'release', 'pending', 'Human-approved local or public release', 2.5, 0, 7.2);
  link('veritas', 'model-pack', 'allows');
  link('evaluation', 'model-pack', 'qualifies');
  link('model-pack', 'release', 'publishes');
  return { layers, nodes, edges, generated_at: new Date().toISOString() };
}
