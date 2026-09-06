// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAssistantPrefs,
  onAssistantPrefsChange,
  setAssistantModelOverride,
  setAssistantPrefs,
  setAssistantReasoningEffort,
} from '../src/ai/assistantPrefs';

beforeEach(() => {
  localStorage.clear();
});

describe('assistant prefs persistence', () => {
  it('round-trips model override and reasoning effort', () => {
    setAssistantPrefs({ modelOverride: ' glm-4.7 ', reasoningEffort: 'high' });
    expect(getAssistantPrefs()).toEqual({ modelOverride: 'glm-4.7', reasoningEffort: 'high' });

    setAssistantModelOverride(undefined);
    expect(getAssistantPrefs()).toEqual({ reasoningEffort: 'high' });

    setAssistantReasoningEffort('low');
    expect(getAssistantPrefs()).toEqual({ reasoningEffort: 'low' });
  });

  it('ignores invalid effort values and blank overrides', () => {
    localStorage.setItem('medbox.assistant-prefs.v1', JSON.stringify({ modelOverride: '   ', reasoningEffort: 'ultra' }));
    expect(getAssistantPrefs()).toEqual({});

    localStorage.setItem('medbox.assistant-prefs.v1', 'not json');
    expect(getAssistantPrefs()).toEqual({});
  });

  it('notifies listeners on change and supports unsubscribe', () => {
    const seen: Array<Record<string, unknown>> = [];
    const stop = onAssistantPrefsChange((prefs) => seen.push(prefs as Record<string, unknown>));
    setAssistantReasoningEffort('medium');
    stop();
    setAssistantModelOverride('model-x');

    expect(seen).toEqual([{ reasoningEffort: 'medium' }]);
  });
});
