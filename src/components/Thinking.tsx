import { Brain } from 'lucide-react';
import { useSettings } from '../lib/settings';
import { THINK_LEVELS, isThinkLevel, type ThinkLevel } from '../lib/thinking';

/** Thinking level picker for the message box: Low, Medium, High, Extra high, Max. */
export function ThinkingPicker() {
  const raw = useSettings((s) => s.thinking);
  const level: ThinkLevel = isThinkLevel(raw) ? raw : 'medium';
  const set = useSettings((s) => s.set);
  const cur = THINK_LEVELS.find((l) => l.id === level)!;
  return (
    <label className={`think-pick think-${level}`} title={`Thinking level: ${cur.label}. ${cur.hint}`}>
      <Brain size={14} aria-hidden="true" />
      <select aria-label="Thinking level" value={level} onChange={(e) => set({ thinking: e.target.value as ThinkLevel })}>
        {THINK_LEVELS.map((l) => (
          <option key={l.id} value={l.id} title={l.hint}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
