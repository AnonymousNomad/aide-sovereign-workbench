// skills-loader.d.mts
// Type declaration for node/src/services/skills-loader.mjs. Used by
// node/src/openapi.ts (TS7016 fix per failure-typescript-mjs-declaration).

export type SkillsLoader = (task: string) => Promise<string>;

export function createSkillsLoader(options: { skillsRoot: string }): SkillsLoader;