// The chosen thinking level, read from Settings (kept apart from thinking.ts
// so that file has no app state and can be tested on its own).
import { useSettings } from './settings';
import { isThinkLevel, thinkingPrompt, type ThinkLevel } from './thinking';

/** The chosen level (Settings / chat box picker). */
export const currentThinking = (): ThinkLevel => {
  const l = useSettings.getState().thinking;
  return isThinkLevel(l) ? l : 'medium';
};

/** Thinking guidance for the chosen level, for the system text. */
export const thinkingText = (opts: { selfCheck?: boolean } = {}) => thinkingPrompt(currentThinking(), opts);
