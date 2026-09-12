import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  ExerciseAttemptRequest,
  ExerciseAttemptResponse,
  ExerciseNextResponse,
  type ExerciseAttemptRequestT,
  type ExerciseAttemptResponseT,
  type ExerciseNextResponseT
} from '../../../common/contracts/exercise.ts';
import type { ExerciseEngine } from '../../../academy/exercise-engine.mjs';

// Verification executes real Python; the descriptor binds the exercise id and
// submitted answer exactly. The learner-state file anchors the workspace and
// the descriptor fails closed when the production layout is absent.
function operationFor(engine: ExerciseEngine, kind: string, taskId: string, body: unknown): OperationInput {
  const statePath = (engine as unknown as { learnerState?: { statePath?: unknown } | null }).learnerState?.statePath;
  if (typeof statePath !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(statePath);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return { workspace: path.dirname(aideDir), taskId, kind, args: { body } };
}

export function routeForExerciseNext(engine: ExerciseEngine): Route {
  return {
    method: 'GET',
    path: '/api/academy/exercises/next',
    response: ExerciseNextResponse,
    handler: (): ExerciseNextResponseT => {
      const id = engine.next();
      if (id === null) return { empty: true };
      const exercise = engine.get(id);
      if (!exercise) return { empty: true };
      return { exercise };
    }
  };
}

export function routeForExerciseAttempt(engine: ExerciseEngine): Route {
  return {
    method: 'POST',
    path: '/api/academy/exercises/attempt',
    body: ExerciseAttemptRequest,
    response: ExerciseAttemptResponse,
    describeOperation: async (ctx, taskId) => operationFor(engine, 'capability.execute', taskId, ctx.body),
    handler: async ({ body }): Promise<ExerciseAttemptResponseT> => {
      const input = body as unknown as ExerciseAttemptRequestT;
      const result = await engine.attempt(input.id, input.answer);
      if (result.error === 'NOT_FOUND') throw new RouteError('NOT_FOUND', `exercise not found: ${input.id}`);
      if (result.error === 'BAD_REQUEST') throw new RouteError('BAD_REQUEST', 'answer must be a string');
      if (result.error) throw new RouteError('NOT_READY', result.message ?? 'verification is unavailable');
      if (typeof result.passed !== 'boolean') throw new RouteError('NOT_READY', 'verification returned no verdict');
      return { passed: result.passed, revealed: result.revealed ?? null };
    }
  };
}
