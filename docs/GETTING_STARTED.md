# AIDE Getting Started

## Local Mode

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run doctor`.
4. Run `npm start`.
5. Open `http://127.0.0.1:4173/`.
6. Select an installed local model.
7. Press **START MODEL** and wait for **Model ready**.
8. Use `ASK / ONE MODEL` for normal chat.
9. Use `PLAN / ONE MODEL` for a plan.
10. Use `AGENT / ONE MODEL` for approved tool proposals.
11. Use `DUAL / TWO MODELS` only when you want a visible analyst-to-builder
    handoff and have a second model available.

## Safe Code Workflow

1. Ask the model to inspect or change the workspace.
2. Choose **PLAN** or start the bounded workflow.
3. Review the plan and patch in the chat/artifact record.
4. Approve only the exact tool or patch you understand.
5. Run a task and inspect Problems and terminal output.
6. Review Git diff before staging or committing.

## If Something Fails

- Run `npm run doctor`.
- Run `npm test`.
- Read the local daemon output.
- Include the command, version, and error in an issue without sharing secrets or
  private source.
