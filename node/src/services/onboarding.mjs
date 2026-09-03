// node/src/services/onboarding.mjs (cline/T4, 2026-09-02)
//
// PR A of aide-onboarding-walkthrough. State machine + atomic persistence.
// Pattern: same as worktree.mjs (synchronous factory, createXxxService({workspace})).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { OnboardingState, OnboardingStep } from '../../../common/contracts/onboarding.ts';

const STEP_ORDER = ["welcome", "privacy", "byok_optin", "desktop_optin", "system_map"];

function makeDefaultState() {
  const now = Date.now();
  const completed = {};
  for (const s of STEP_ORDER) completed[s] = { skipped: false, completed_at: null };
  return {
    current_step: "welcome",
    completed,
    user_choices: {},
    walkthrough_complete: false,
    started_at: now,
    updated_at: now
  };
}

function nextStepName(current) {
  const i = STEP_ORDER.indexOf(current);
  if (i < 0 || i >= STEP_ORDER.length - 1) return current;
  return STEP_ORDER[i + 1];
}

async function readState(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = OnboardingState.parse(JSON.parse(raw));
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return makeDefaultState();
    // Corrupt state: reset (atomic write protects the next save).
    return makeDefaultState();
  }
}

async function writeStateAtomic(filePath, state) {
  state.updated_at = Date.now();
  const partial = filePath + ".partial";
  // Ensure the parent directory exists (first write on a fresh workspace).
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(partial, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(partial, filePath);
}

export function createOnboardingService({ workspace }) {
  if (!workspace) throw new Error("workspace is required");
  const stateFile = path.join(workspace, ".aide", "onboarding-state.json");

  async function getState() {
    return readState(stateFile);
  }

  async function setState(next) {
    const parsed = OnboardingState.parse(next);
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await writeStateAtomic(stateFile, parsed);
    return parsed;
  }

  async function nextStep(partial) {
    const current = await getState();
    if (partial && typeof partial === "object") {
      Object.assign(current.user_choices, partial);
    }
    current.completed[current.current_step] = { skipped: false, completed_at: Date.now() };
    const advanced = nextStepName(current.current_step);
    current.current_step = advanced;
    if (advanced === "system_map") {
      // Stay on the last step until complete() is called.
      current.current_step = "system_map";
    }
    await writeStateAtomic(stateFile, current);
    return { state: current, advanced_to: current.current_step };
  }

  async function skipStep(partial) {
    const current = await getState();
    if (partial && typeof partial === "object") {
      Object.assign(current.user_choices, partial);
    }
    current.completed[current.current_step] = { skipped: true, completed_at: Date.now() };
    current.current_step = nextStepName(current.current_step);
    await writeStateAtomic(stateFile, current);
    return current;
  }

  async function complete() {
    const current = await getState();
    current.completed.system_map = { skipped: false, completed_at: Date.now() };
    current.walkthrough_complete = true;
    await writeStateAtomic(stateFile, current);
    return current;
  }

  return { getState, setState, nextStep, skipStep, complete };
}
