import { RouteError, type Route, type RouteContext } from '../server.ts';
import { AuthorityPairRequest, AuthoritySessionResponse, AuthorityDecisionRequest, AuthorityDecisionResponse,
  AuthorityOperationResponse, AuthorityPrepareRequest, AuthorityInspectQuery } from '../../../common/contracts/authority.ts';

function service(ctx: RouteContext) {
  if (!ctx.authority) throw new RouteError('NOT_READY', 'execution authority is not connected');
  return ctx.authority;
}
function actor(ctx: RouteContext) {
  if (!ctx.actor) throw new RouteError('FORBIDDEN', 'authenticated actor required');
  return ctx.actor;
}
export function routesForAuthority(): Route[] {
  return [
    { method: 'POST', path: '/api/authority/pair', authorityMode: 'pair', body: AuthorityPairRequest, response: AuthoritySessionResponse,
      handler: ctx => service(ctx).pair((ctx.body as { proof: string }).proof, ctx.origin ?? '') },
    { method: 'POST', path: '/api/authority/prepare', authorityMode: 'control', body: AuthorityPrepareRequest, response: AuthorityOperationResponse,
      handler: ctx => {
        actor(ctx);
        if (!ctx.prepareOperation) throw new RouteError('NOT_READY', 'operation adapter unavailable');
        return ctx.prepareOperation(AuthorityPrepareRequest.parse(ctx.body));
      } },
    { method: 'POST', path: '/api/authority/decision', authorityMode: 'control', body: AuthorityDecisionRequest, response: AuthorityDecisionResponse,
      handler: async ctx => {
        const input = AuthorityDecisionRequest.parse(ctx.body);
        return { operation: await service(ctx).decide(actor(ctx), input.operation_id, input.decision) };
      } },
    { method: 'GET', path: '/api/authority/operation', authorityMode: 'control', query: AuthorityInspectQuery, response: AuthorityOperationResponse,
      handler: ctx => service(ctx).inspect(actor(ctx), AuthorityInspectQuery.parse(ctx.query).id) }
  ];
}
