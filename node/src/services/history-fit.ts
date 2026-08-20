import type { ChatMessageT } from '../../../common/contracts/chat.ts';

export const TOKEN_RESERVE = 512;
const TOOL_ROLES = new Set(['tool', 'tool_result']);

export interface FitOptions {
  maxTokens?: number;
}

export interface FitResult {
  messages: ChatMessageT[];
  dropped: number;
  truncatedSystem: boolean;
  estimatedTokens: number;
  overflow: boolean;
}

export interface FitMessage {
  role: string;
  content: string;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function fitHistory(messages: FitMessage[], contextLength: number, options: FitOptions = {}): FitResult {
  const reserve = options.maxTokens ?? TOKEN_RESERVE;
  const budget = Math.max(1, contextLength - reserve);
  const system: FitMessage[] = [];
  const rest: FitMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') system.push(message);
    else rest.push(message);
  }

  const fittedSystem: FitMessage[] = [];
  let estimated = 0;
  let dropped = 0;
  let truncatedSystem = false;

  for (const message of system) {
    if (message.content.length === 0) {
      dropped += 1;
      continue;
    }
    const cost = estimateTokens(message.content);
    if (estimated + cost <= budget) {
      fittedSystem.push(message);
      estimated += cost;
    } else {
      const keepChars = Math.max(0, (budget - estimated) * 4);
      if (keepChars > 0) {
        fittedSystem.push({ role: message.role, content: message.content.slice(0, keepChars) });
        estimated += budget - estimated;
      }
      truncatedSystem = true;
      dropped += 1;
    }
  }

  const keptRest: FitMessage[] = [];
  for (let index = rest.length - 1; index >= 0; index--) {
    const message = rest[index]!;
    if (TOOL_ROLES.has(message.role)) {
      dropped += 1;
      continue;
    }
    if (estimated + estimateTokens(message.content) > budget) {
      dropped += 1;
      continue;
    }
    keptRest.push(message);
    estimated += estimateTokens(message.content);
  }

  keptRest.reverse();

  const newest = rest[rest.length - 1];
  if (newest !== undefined && !TOOL_ROLES.has(newest.role) && !keptRest.includes(newest)) {
    keptRest.push(newest);
    estimated += estimateTokens(newest.content);
  }

  const overflow = truncatedSystem;
  const fittedMessages: ChatMessageT[] = [...fittedSystem, ...keptRest].map(message =>
    message.role === 'user' || message.role === 'assistant' || message.role === 'system'
      ? (message as ChatMessageT)
      : { role: 'system', content: message.content }
  );
  return { messages: fittedMessages, dropped, truncatedSystem, estimatedTokens: estimated, overflow };
}