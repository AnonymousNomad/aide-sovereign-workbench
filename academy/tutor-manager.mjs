import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export class TutorManager {
  constructor({ coursesDir, progressPath }) {
    this.coursesDir = coursesDir;
    this.progressPath = progressPath;
    this.courses = [];
    this.progress = {};
  }

  async load() {
    await fs.mkdir(path.dirname(this.progressPath), { recursive: true });
    const files = await fs.readdir(this.coursesDir).catch(() => []);
    this.courses = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await fs.readFile(path.join(this.coursesDir, file), 'utf8'))));
    this.progress = JSON.parse(await fs.readFile(this.progressPath, 'utf8').catch(() => '{}'));
    return this.catalog();
  }

  catalog() {
    return this.courses.map(course => { const progress = this.progress[course.id] || { completed: [], current: course.lessons[0]?.id || null }; return { ...course, progress: { ...progress, eligible_for_certificate: course.lessons.length > 0 && course.lessons.every(lesson => progress.completed.includes(lesson.id)) } }; });
  }

  session(courseId) {
    const course = this.courses.find(item => item.id === courseId) || this.courses[0];
    if (!course) throw new Error('no tutor courses installed');
    const progress = this.progress[course.id] || { completed: [], current: course.lessons[0]?.id || null };
    const current = course.lessons.find(lesson => lesson.id === progress.current) || course.lessons[0];
    return { course: { id: course.id, title: course.title, level: course.level }, lesson: current, progress, next: course.lessons.find(lesson => !progress.completed.includes(lesson.id)) || null };
  }

  async complete(courseId, lessonId, reflection = '') {
    const course = this.courses.find(item => item.id === courseId);
    if (!course || !course.lessons.some(lesson => lesson.id === lessonId)) throw new Error('lesson is not in the selected course');
    const progress = this.progress[courseId] || { completed: [], current: lessonId };
    if (progress.last_check?.lessonId !== lessonId || progress.last_check.passed !== true) throw new Error('run and pass the lesson check before completing it');
    if (!progress.completed.includes(lessonId)) progress.completed.push(lessonId);
    const next = course.lessons.find(lesson => !progress.completed.includes(lesson.id));
    progress.current = next?.id || lessonId;
    progress.last_reflection = String(reflection).slice(0, 1000);
    progress.updated_at = new Date().toISOString();
    this.progress[courseId] = progress;
    const temp = `${this.progressPath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.progress, null, 2));
    await fs.rename(temp, this.progressPath);
    return this.session(courseId);
  }

  async check(courseId, lessonId) {
    const course = this.courses.find(item => item.id === courseId); const lesson = course?.lessons.find(item => item.id === lessonId);
    if (!lesson) throw new Error('lesson is not in the selected course');
    const match = String(lesson.check || '').match(/^(python3?|node|git)\s+(-c|-e|--version)(?:\s+([\s\S]*))?$/);
    if (!match) throw new Error('lesson check is not a supported allowlisted command');
    const args = [match[2]]; if (match[3]) args.push(match[3].replace(/^['"]|['"]$/g, ''));
    let result; try { const output = await run(match[1], args, { timeout: 30_000, maxBuffer: 64 * 1024 }); result = { passed: true, stdout: output.stdout, stderr: output.stderr }; } catch (error) { result = { passed: false, stdout: error.stdout || '', stderr: error.stderr || error.message }; }
    const progress = this.progress[courseId] || { completed: [], current: lessonId }; progress.last_check = { lessonId, ...result, checked_at: new Date().toISOString() }; this.progress[courseId] = progress;
    const temp = `${this.progressPath}.tmp`; await fs.writeFile(temp, JSON.stringify(this.progress, null, 2)); await fs.rename(temp, this.progressPath);
    return { lesson: lesson.id, ...result };
  }

  certificate(courseId) {
    const course = this.courses.find(item => item.id === courseId); if (!course) throw new Error('course is not installed');
    const progress = this.progress[courseId] || { completed: [] }; if (!course.lessons.every(lesson => progress.completed.includes(lesson.id))) throw new Error('complete every assessed lesson first');
    const issued = new Date().toISOString(); const credential = { type: ['VerifiableCredential', 'AIDECompletionCredential'], issuer: 'AIDE local issuer (unaccredited)', issuanceDate: issued, credentialSubject: { course_id: course.id, course_title: course.title, lessons_completed: course.lessons.length, assessment: course.assessment }, evidence: { completed_lesson_ids: progress.completed, reflections_recorded: Boolean(progress.last_reflection) }, status: 'locally-verifiable-unaccredited' };
    return { credential, digest: crypto.createHash('sha256').update(JSON.stringify(credential)).digest('hex'), limitation: 'This local credential is not an accredited professional certification and has no employer recognition unless an independent issuer accepts it.' };
  }
}
