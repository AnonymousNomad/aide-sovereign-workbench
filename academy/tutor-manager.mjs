import { promises as fs } from 'node:fs';
import path from 'node:path';

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
    return this.courses.map(course => ({ ...course, progress: this.progress[course.id] || { completed: [], current: course.lessons[0]?.id || null } }));
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
}
