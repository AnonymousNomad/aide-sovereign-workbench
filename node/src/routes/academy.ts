import { RouteError, type Route } from '../server.ts';
import {
  AcademyCatalogResponse,
  AcademyCertificateQuery,
  AcademyCertificateResponse,
  AcademyCheckRequest,
  AcademyCheckResponse,
  AcademyCompleteRequest,
  AcademyCompleteResponse,
  AcademySessionQuery,
  AcademySessionResponse,
  type AcademyCatalogCourseT,
  type AcademyCatalogResponseT,
  type AcademyCertificateQueryT,
  type AcademyCertificateResponseT,
  type AcademyCheckRequestT,
  type AcademyCheckResponseT,
  type AcademyCompleteRequestT,
  type AcademyCompleteResponseT,
  type AcademySessionQueryT,
  type AcademySessionResponseT
} from '../../../common/contracts/academy.ts';
import type { TutorManager } from '../../../academy/tutor-manager.mjs';

export function routeForAcademyCatalog(tutor: TutorManager): Route {
  return {
    method: 'GET',
    path: '/api/academy',
    response: AcademyCatalogResponse,
    handler: (): AcademyCatalogResponseT => ({
      courses: tutor.catalog() as unknown as AcademyCatalogCourseT[]
    })
  };
}

export function routeForAcademySession(tutor: TutorManager): Route {
  return {
    method: 'GET',
    path: '/api/academy/session',
    query: AcademySessionQuery,
    response: AcademySessionResponse,
    handler: ({ query }): AcademySessionResponseT => {
      const input = query as unknown as AcademySessionQueryT;
      try {
        return tutor.session(input.course) as unknown as AcademySessionResponseT;
      } catch (error) {
        throw new RouteError('NOT_READY', error instanceof Error ? error.message : 'no tutor courses installed');
      }
    }
  };
}

export function routeForAcademyCheck(tutor: TutorManager): Route {
  return {
    method: 'POST',
    path: '/api/academy/check',
    body: AcademyCheckRequest,
    response: AcademyCheckResponse,
    handler: async ({ body }): Promise<AcademyCheckResponseT> => {
      const input = body as unknown as AcademyCheckRequestT;
      const found = tutor.findLesson(input.courseId, input.lessonId);
      if (!found) throw new RouteError('NOT_FOUND', 'lesson is not in the selected course');
      try {
        return (await tutor.check(input.courseId, input.lessonId)) as unknown as AcademyCheckResponseT;
      } catch (error) {
        throw new RouteError('BAD_REQUEST', error instanceof Error ? error.message : 'lesson check failed');
      }
    }
  };
}

export function routeForAcademyComplete(tutor: TutorManager): Route {
  return {
    method: 'POST',
    path: '/api/academy/complete',
    body: AcademyCompleteRequest,
    response: AcademyCompleteResponse,
    handler: async ({ body }): Promise<AcademyCompleteResponseT> => {
      const input = body as unknown as AcademyCompleteRequestT;
      try {
        return (await tutor.complete(input.courseId, input.lessonId, input.reflection)) as unknown as AcademyCompleteResponseT;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'lesson completion failed';
        if (/lesson is not in the selected course/.test(message)) throw new RouteError('NOT_FOUND', message);
        throw new RouteError('CONFLICT', message);
      }
    }
  };
}

export function routeForAcademyCertificate(tutor: TutorManager): Route {
  return {
    method: 'GET',
    path: '/api/academy/certificate',
    query: AcademyCertificateQuery,
    response: AcademyCertificateResponse,
    handler: ({ query }: { query: unknown }): AcademyCertificateResponseT => {
      const input = query as unknown as AcademyCertificateQueryT;
      try {
        return tutor.certificate(input.course as string) as unknown as AcademyCertificateResponseT;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'certificate unavailable';
        if (/course is not installed/.test(message)) throw new RouteError('NOT_FOUND', message);
        throw new RouteError('CONFLICT', message);
      }
    }
  };
}

export function routesForAcademy(tutor: TutorManager): Route[] {
  return [
    routeForAcademyCatalog(tutor),
    routeForAcademySession(tutor),
    routeForAcademyCheck(tutor),
    routeForAcademyComplete(tutor),
    routeForAcademyCertificate(tutor)
  ];
}