import type {
  Finding,
  FindingAggregationCoverage,
  LabeledIssueFinding,
  MissingLocalTargetFinding,
  PossibleMissingNpmScriptFinding,
} from '@docscout/shared';

export function combineFindings(
  markdownLinks: MissingLocalTargetFinding[],
  npmScripts: PossibleMissingNpmScriptFinding[],
  labeledIssues: LabeledIssueFinding[],
  documentationFindingsAlreadyOmitted: number,
): { findings: Finding[]; coverage: FindingAggregationCoverage } {
  const documentation = [...markdownLinks, ...npmScripts];
  const includedDocumentation = documentation.slice(0, 50);
  return {
    findings: [...includedDocumentation, ...labeledIssues],
    coverage: {
      documentationFindingsProduced: includedDocumentation.length,
      documentationFindingsOmitted: documentationFindingsAlreadyOmitted
        + documentation.length - includedDocumentation.length,
      issueFindingsProduced: labeledIssues.length,
    },
  };
}
