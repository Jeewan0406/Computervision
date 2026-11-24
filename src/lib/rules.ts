// The site owner's answer rules, sent as system text to every model in
// Chat, Compare, Team and Agent. The rules are stored as Markdown files so
// they stay exactly as written; Settings can switch them off or edit them.
import RULES from '../rules/answer-rules.md?raw';
import CONTEXT from '../rules/jeea-context.md?raw';
import { useSettings } from './settings';

export const DEFAULT_RULES = RULES.trim();
export const RULES_CONTEXT = CONTEXT.trim();

/** Full system text for the rules, or '' when they are off. */
export function rulesText(): string {
  const r = useSettings.getState().answerRules;
  if (!r?.enabled) return '';
  const body = (r.text ?? DEFAULT_RULES).trim();
  if (!body) return '';
  return `${RULES_CONTEXT}\n\n# The site owner's answer rules\n\n${body}`;
}

/** Rough size: about 4 characters per token. */
export const roughTokens = (s: string) => Math.ceil(s.length / 4);

/** Errors that usually mean the request was too long for the model's limit. */
export const TOO_LONG = /context.?length|context window|too (long|large)|maximum (context|.*tokens)|max_tokens|reduce the length|request entity too large|\b413\b|tokens per minute|\bTPM\b|rate_limit_exceeded.*tokens/i;
