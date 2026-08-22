import { type Route, type RouteContext, RouteError } from '../server.ts';
import { ProblemsParseRequest, ProblemsParseResponse } from '../../../common/contracts/tasks.ts';
import { TaskService } from '../../../node/src/services/task-service.mjs';
import { parseProblems } from '../../../node/src/services/problem-parser.mjs';

export function routesForProblems(workspaceRoot: string): Route[] {
  const tasks = new TaskService({ workspace: workspaceRoot });
  return [
    {
      method: 'POST',
      path: '/api/problems/parse',
      body: ProblemsParseRequest,
      response: ProblemsParseResponse,
      handler: async (ctx: RouteContext) => {
        const request = ctx.body as { matcher: unknown; text: string };
        let matchers: unknown[];
        try {
          matchers = await tasks.resolveJobMatcher({ problemMatcher: request.matcher });
        } catch (error) {
          const message = String((error as Error)?.message ?? error);
          if ((error as Error)?.name === 'BAD_REQUEST' || (error as Error)?.name === 'MATCHER') {
            throw new RouteError('BAD_REQUEST', message);
          }
          throw new RouteError('INTERNAL', message.slice(0, 500));
        }
        const merged: Array<Record<string, unknown>> = [];
        const seen = new Set<string>();
        let dropped = 0;
        for (const matcher of matchers) {
          const result = parseProblems(matcher as never, request.text, { workspaceRoot });
          dropped += result.dropped;
          for (const problem of result.problems) {
            const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(problem as unknown as Record<string, unknown>);
            }
          }
        }
        return { problems: merged, dropped };
      }
    }
  ];
}
