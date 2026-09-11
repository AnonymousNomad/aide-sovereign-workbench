import { z } from 'zod';

export const AcademyLesson = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.string().min(1),
    objective: z.string().min(1),
    check: z.string().min(1)
  })
  .strict();

export type AcademyLessonT = z.infer<typeof AcademyLesson>;

export const AcademyCourseSummary = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    level: z.string().min(1)
  })
  .strict();

export type AcademyCourseSummaryT = z.infer<typeof AcademyCourseSummary>;

export const AcademyLastCheck = z
  .object({
    lessonId: z.string().min(1),
    passed: z.boolean(),
    stdout: z.string(),
    stderr: z.string(),
    checked_at: z.string()
  })
  .strict();

export const AcademyProgress = z
  .object({
    completed: z.array(z.string()),
    current: z.string().nullable(),
    last_check: AcademyLastCheck.optional(),
    last_reflection: z.string().optional(),
    updated_at: z.string().optional()
  })
  .strict();

export type AcademyProgressT = z.infer<typeof AcademyProgress>;

export const AcademyCatalogCourse = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    level: z.string().min(1),
    description: z.string(),
    estimated_hours: z.number(),
    prerequisites: z.string(),
    assessment: z.string(),
    lessons: z.array(AcademyLesson),
    progress: AcademyProgress.extend({ eligible_for_certificate: z.boolean() }).strict()
  })
  .strict();

export type AcademyCatalogCourseT = z.infer<typeof AcademyCatalogCourse>;

export const AcademyCatalogResponse = z
  .object({
    courses: z.array(AcademyCatalogCourse)
  })
  .strict();

export type AcademyCatalogResponseT = z.infer<typeof AcademyCatalogResponse>;

export const AcademySessionQuery = z
  .object({
    course: z.string().min(1).max(128).optional()
  })
  .strict();

export type AcademySessionQueryT = z.infer<typeof AcademySessionQuery>;

export const AcademySessionResponse = z
  .object({
    course: AcademyCourseSummary,
    lesson: AcademyLesson,
    progress: AcademyProgress,
    next: z.union([AcademyLesson, z.null()])
  })
  .strict();

export type AcademySessionResponseT = z.infer<typeof AcademySessionResponse>;

export const AcademyCheckRequest = z
  .object({
    courseId: z.string().min(1).max(128),
    lessonId: z.string().min(1).max(128)
  })
  .strict();

export type AcademyCheckRequestT = z.infer<typeof AcademyCheckRequest>;

export const AcademyCheckResponse = z
  .object({
    lesson: z.string().min(1),
    passed: z.boolean(),
    stdout: z.string(),
    stderr: z.string()
  })
  .strict();

export type AcademyCheckResponseT = z.infer<typeof AcademyCheckResponse>;

export const AcademyCompleteRequest = z
  .object({
    courseId: z.string().min(1).max(128),
    lessonId: z.string().min(1).max(128),
    reflection: z.string().max(1000).optional()
  })
  .strict();

export type AcademyCompleteRequestT = z.infer<typeof AcademyCompleteRequest>;

export const AcademyCompleteResponse = AcademySessionResponse;

export type AcademyCompleteResponseT = z.infer<typeof AcademyCompleteResponse>;

export const AcademyCertificateQuery = z
  .object({
    course: z.string().min(1).max(128).optional()
  })
  .strict();

export type AcademyCertificateQueryT = z.infer<typeof AcademyCertificateQuery>;

export const AcademyCertificateResponse = z
  .object({
    credential: z
      .object({
        type: z.array(z.string()),
        issuer: z.string(),
        issuanceDate: z.string(),
        credentialSubject: z
          .object({
            course_id: z.string().min(1),
            course_title: z.string().min(1),
            lessons_completed: z.number().int().min(0),
            assessment: z.string()
          })
          .strict(),
        evidence: z
          .object({
            completed_lesson_ids: z.array(z.string()),
            reflections_recorded: z.boolean()
          })
          .strict(),
        status: z.string()
      })
      .strict(),
    digest: z.string(),
    limitation: z.string()
  })
  .strict();

export type AcademyCertificateResponseT = z.infer<typeof AcademyCertificateResponse>;