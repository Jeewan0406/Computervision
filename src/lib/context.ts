// Builds the personal part of every request: the user's custom instructions
// and the conversation's project (instructions + files), plus the order of
// priority. Used by Chat, Compare, Team, Agent and CodeFrame.
import { useSettings, type Area } from './settings';
import { BUDGET_CHARS, getProject, projectFiles } from './projects';
import { customPrompt, knowledgeBlock, priorityNote, projectPrompt, type KnowledgeResult } from './instructions';

export interface PersonalContext {
  text: string;
  custom: boolean;
  project?: { name: string; knowledge: KnowledgeResult };
}

export async function personalContext(area: Area, projectId: string | undefined, question: string): Promise<PersonalContext> {
  const st = useSettings.getState();
  const c = st.custom;
  const customText = c?.enabled && c.areas?.[area] !== false ? customPrompt(c.text ?? '') : '';
  const p = getProject(projectId);
  let projectText = '';
  let project: PersonalContext['project'];
  if (p) {
    const knowledge = knowledgeBlock(await projectFiles(p), question, BUDGET_CHARS[p.budget] ?? BUDGET_CHARS.medium);
    projectText = projectPrompt(p, knowledge, p.files.length);
    project = { name: p.name, knowledge };
  }
  const note = priorityNote({ rules: !!st.answerRules?.enabled, custom: !!customText, project: !!projectText });
  return { text: [customText, projectText, note].filter(Boolean).join('\n\n'), custom: !!customText, project };
}
