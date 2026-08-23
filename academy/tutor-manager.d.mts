export interface TutorLesson {
  id: string;
  title: string;
  kind?: string;
  objective?: string;
  check?: string;
}

export interface TutorCourse {
  id: string;
  title: string;
  level?: string;
  lessons: TutorLesson[];
}

export interface TutorProgress {
  completed?: string[];
  current?: string | null;
}

export declare class TutorManager {
  constructor(options: {
    coursesDir: string;
    progressPath: string;
    pythonPath?: string;
    learnerState?: unknown | null;
  });
  load(): Promise<unknown>;
  catalog(): Array<TutorCourse & { progress: TutorProgress & { eligible_for_certificate: boolean } }>;
  session(courseId?: string): unknown;
  complete(courseId: string, lessonId: string, reflection?: string): Promise<unknown>;
  check(courseId: string, lessonId: string): Promise<{ lesson: string; passed: boolean; stdout: string; stderr: string }>;
  certificate(courseId: string): unknown;
  findLesson(courseId: string, lessonId: string): { courseId: string; lesson: TutorLesson } | null;
}
