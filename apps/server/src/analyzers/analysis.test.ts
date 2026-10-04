import { describe, expect, it } from 'vitest';
import type {
  LabeledIssueFinding,
  MissingLocalTargetFinding,
  PossibleMissingNpmScriptFinding,
} from '@docscout/shared';
import { combineFindings } from './analysis.js';

describe('common Phase 2 finding ordering', () => {
  it('keeps documentation findings before labeled issue opportunities', () => {
    const markdown = { id: 'markdown', type: 'missing-local-target' } as MissingLocalTargetFinding;
    const npm = { id: 'npm', type: 'possible-missing-npm-script' } as PossibleMissingNpmScriptFinding;
    const issue = { id: 'issue', type: 'labeled-issue' } as LabeledIssueFinding;

    expect(combineFindings([markdown], [npm], [issue], 0)).toEqual({
      findings: [markdown, npm, issue],
      coverage: {
        documentationFindingsProduced: 2,
        documentationFindingsOmitted: 0,
        issueFindingsProduced: 1,
      },
    });
  });

  it('caps the combined documentation findings at 50 without consuming issue capacity', () => {
    const markdown = Array.from({ length: 30 }, (_, index) => ({
      id: `markdown-${index}`, type: 'missing-local-target',
    })) as MissingLocalTargetFinding[];
    const npm = Array.from({ length: 30 }, (_, index) => ({
      id: `npm-${index}`, type: 'possible-missing-npm-script',
    })) as PossibleMissingNpmScriptFinding[];
    const issues = Array.from({ length: 2 }, (_, index) => ({
      id: `issue-${index}`, type: 'labeled-issue',
    })) as LabeledIssueFinding[];

    const result = combineFindings(markdown, npm, issues, 3);

    expect(result.findings).toHaveLength(52);
    expect(result.findings.slice(0, 30)).toEqual(markdown);
    expect(result.findings.slice(30, 50)).toEqual(npm.slice(0, 20));
    expect(result.findings.slice(50)).toEqual(issues);
    expect(result.coverage).toEqual({
      documentationFindingsProduced: 50,
      documentationFindingsOmitted: 13,
      issueFindingsProduced: 2,
    });
  });
});
