import { RouteError, type Route } from '../server.ts';
import { HintQuery, HintResult, type HintQueryT, type HintResultT } from '../../../common/contracts/hint.ts';
import { nextHint } from '../../../academy/hint-engine.mjs';
import type { TutorManager } from '../../../academy/tutor-manager.mjs';

export function routeForAcademyHint(tutor: TutorManager): Route {
  return {
    method: 'GET',
    path: '/api/academy/hint',
    query: HintQuery,
    response: HintResult,
    handler: ({ query }): HintResultT => {
      const input = query as unknown as HintQueryT;
      const found = tutor.findLesson(input.course, input.lesson);
      if (!found) throw new RouteError('NOT_FOUND', `lesson not found in course: ${input.course}/${input.lesson}`);
      return nextHint(found.lesson, input.after ?? 0);
    }
  };
}
