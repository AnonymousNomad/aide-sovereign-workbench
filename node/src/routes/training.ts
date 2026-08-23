import { RouteError, type Route } from '../server.ts';
import {
  TrainingCheckpointsQuery,
  TrainingCheckpointsResponse,
  TrainingPresetsResponse,
  TrainingStartRequest,
  TrainingStatusResponse,
  TrainingStopRequest,
  TrainingStopResponse,
  type TrainingCheckpointsQueryT,
  type TrainingCheckpointsResponseT,
  type TrainingPresetsResponseT,
  type TrainingStartRequestT,
  type TrainingStatusResponseT,
  type TrainingStopResponseT
} from '../../../common/contracts/training.ts';
import { PRESETS } from '../../../daemon/training-runner.mjs';
import type { DatasetStore } from '../../../daemon/dataset-store.mjs';
import type { TrainingRunner } from '../../../daemon/training-runner.mjs';

function presetSummaries(): TrainingPresetsResponseT {
  return {
    presets: Object.entries(PRESETS).map(([key, preset]) => ({
      key,
      label: preset.label,
      r: preset.r,
      lora_alpha: preset.lora_alpha,
      learning_rate: preset.learning_rate,
      epochs: preset.epochs,
      per_device_batch: preset.per_device_batch,
      gradient_accumulation: preset.gradient_accumulation,
      max_seq_len: preset.max_seq_len,
      fp16: preset.fp16,
      bf16: preset.bf16
    }))
  };
}

export function routeForTrainingPresets(): Route {
  return {
    method: 'GET',
    path: '/api/training/presets',
    response: TrainingPresetsResponse,
    handler: (): TrainingPresetsResponseT => presetSummaries()
  };
}

export function routeForTrainingStatus(runner: TrainingRunner): Route {
  return {
    method: 'GET',
    path: '/api/training/status',
    response: TrainingStatusResponse,
    handler: (): TrainingStatusResponseT => runner.status() as unknown as TrainingStatusResponseT
  };
}

export function routeForTrainingStart(runner: TrainingRunner, store: DatasetStore): Route {
  return {
    method: 'POST',
    path: '/api/training/start',
    body: TrainingStartRequest,
    response: TrainingStatusResponse,
    handler: async ({ body }): Promise<TrainingStatusResponseT> => {
      const input = body as unknown as TrainingStartRequestT;
      const dataset = store.get(input.dataset_id);
      if (!dataset) throw new RouteError('NOT_FOUND', `dataset not found: ${input.dataset_id}`);
      const result = await runner.start({
        datasetId: dataset.id,
        datasetPath: store.jsonlPath(dataset.id),
        sampleCount: dataset.count,
        preset: input.preset ?? '0.5b',
        approved: input.approved
      });
      if (result.error === 'FORBIDDEN') throw new RouteError('FORBIDDEN', 'training must be explicitly approved');
      if (result.error === 'CONFLICT') throw new RouteError('CONFLICT', 'a training job is already running');
      if (result.error) throw new RouteError('BAD_REQUEST', result.message ?? 'invalid training request');
      return result as unknown as TrainingStatusResponseT;
    }
  };
}

export function routeForTrainingStop(runner: TrainingRunner): Route {
  return {
    method: 'POST',
    path: '/api/training/stop',
    body: TrainingStopRequest,
    response: TrainingStopResponse,
    handler: (): TrainingStopResponseT => runner.stop()
  };
}

export function routeForTrainingCheckpoints(runner: TrainingRunner): Route {
  return {
    method: 'GET',
    path: '/api/training/checkpoints',
    query: TrainingCheckpointsQuery,
    response: TrainingCheckpointsResponse,
    handler: async ({ query }): Promise<TrainingCheckpointsResponseT> => {
      const input = query as unknown as TrainingCheckpointsQueryT;
      const checkpoints = await runner.checkpoints(input.job_id ?? null);
      return { checkpoints };
    }
  };
}
