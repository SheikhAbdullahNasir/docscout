import type { Finding, RepositoryDocument, RepositorySnapshotResponse } from '@docscout/shared';
import { ApplicationError } from '../errors.js';

const MAX_BROWSER_BYTES = 3 * 1024 * 1024;

/** Count the exact UTF-8 JSON size without first serializing the entire response. */
function jsonBytes(value: unknown): number {
  if (Array.isArray(value)) return 2 + Math.max(0, value.length - 1)
    + value.reduce<number>((size, item: unknown) => size + jsonBytes(item), 0);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    return 2 + Math.max(0, entries.length - 1)
      + entries.reduce((size, [key, item]) => size + jsonBytes(key) + 1 + jsonBytes(item), 0);
  }
  return Buffer.byteLength(JSON.stringify(value) ?? 'null', 'utf8');
}

function preview(text: string, maximum: number): string {
  // Keep a surrogate pair intact when a preview ends in the middle of one.
  return text.slice(0, maximum).replace(/[\uD800-\uDBFF]$/u, '');
}

export function boundBrowserResponse(original: RepositorySnapshotResponse, githubRequests = 0): RepositorySnapshotResponse {
  if (jsonBytes(original) <= MAX_BROWSER_BYTES) return original;
  const result = structuredClone(original);
  const omissions = { previews: 0, excerpts: 0, treeEntries: 0, issueRecords: 0, documents: 0, skippedDocuments: 0, findings: 0 };
  result.scan = {
    status: 'partial', githubRequests: result.scan?.githubRequests ?? githubRequests,
    warnings: [...result.scan?.warnings ?? [], { code: 'BROWSER_RESPONSE_LIMIT',
      message: 'Some previews or result details were shortened or omitted to keep the browser response within 3 MiB. Retained findings keep their source references; omitted details are not evidence of absence.' }],
    responseOmissions: omissions,
  };
  const analysis = result.status === 'ready' ? result.snapshot.analysis : result.analysis;
  const findingLists: Finding[][] = [analysis.findings, analysis.labeledIssues.findings];
  const documents: RepositoryDocument[] = [];
  if (result.status === 'ready') {
    findingLists.push(result.snapshot.analysis.markdownLinks.findings, result.snapshot.analysis.npmScripts.findings);
    const selected = result.snapshot.documents;
    for (const state of [selected.readme, selected.contributing, selected.packageJson]) {
      if (state.status === 'available') documents.push(state.document);
    }
    documents.push(...selected.docs);
  }
  for (const document of documents) {
    if (document.text.length > 4096) {
      document.text = preview(document.text, 4096);
      document.previewTruncated = true;
      omissions.previews += 1;
    }
  }
  for (const issue of result.issues.items) {
    if (issue.bodyExcerpt.length > 512) {
      issue.bodyExcerpt = preview(issue.bodyExcerpt, 512);
      issue.bodyExcerptTruncated = true;
      omissions.excerpts += 1;
    }
  }
  const findings = [...new Set(findingLists.flat())];
  for (const finding of findings) {
    if (finding.evidence.excerpt.length > 512) {
      finding.evidence.excerpt = preview(finding.evidence.excerpt, 512);
      finding.evidence.excerptTruncated = true;
      omissions.excerpts += 1;
    }
  }
  const fits = () => jsonBytes(result) <= MAX_BROWSER_BYTES;
  if (fits()) return result;

  // A fetched tree can fit the 10 MiB upstream cap but exceed the browser cap.
  // Keep pinned identifiers and already-derived findings, disclose delivery omissions.
  if (result.status === 'ready' && result.snapshot.tree.entries.length) {
    omissions.treeEntries = result.snapshot.tree.entries.length;
    result.snapshot.tree.entries = [];
    result.snapshot.tree.complete = false;
  }
  if (fits()) return result;
  if (result.issues.items.length) {
    omissions.issueRecords = result.issues.items.length;
    result.issues.items = [];
    result.issues.coverage.complete = false;
    analysis.labeledIssues.coverage.issueRetrieval.complete = false;
  }
  if (fits()) return result;

  // Never shorten required paths, URLs, labels, commands, or other structural evidence.
  // Omit whole oversized records only when preview reductions are insufficient.
  if (result.status === 'ready') {
    const selected = result.snapshot.documents;
    for (const document of documents.sort((left, right) => jsonBytes(right) - jsonBytes(left))) {
      if (fits()) break;
      // Ordinary bounded previews cannot dominate this fallback; retain them
      // while oversized structural evidence is considered for whole-record omission.
      if (jsonBytes(document) <= 64 * 1024) continue;
      for (const key of ['readme', 'contributing', 'packageJson'] as const) {
        const state = selected[key];
        if (state.status === 'available' && state.document === document) {
          selected[key] = { status: 'unknown', message: 'This document preview was omitted by the browser response size limit.' };
        }
      }
      selected.docs = selected.docs.filter((item) => item !== document);
      omissions.documents += 1;
      if (!selected.omissions.includes('BROWSER_RESPONSE_LIMIT')) selected.omissions.push('BROWSER_RESPONSE_LIMIT');
    }
    if (!fits() && selected.skipped.length) {
      omissions.skippedDocuments = selected.skipped.length;
      selected.skipped = [];
      if (!selected.omissions.includes('BROWSER_RESPONSE_LIMIT')) selected.omissions.push('BROWSER_RESPONSE_LIMIT');
    }
  }
  if (fits()) return result;

  const removeFinding = (finding: Finding) => {
    const combinedIndex = analysis.findings.findIndex(({ id }) => id === finding.id);
    if (combinedIndex !== -1) {
      analysis.findings.splice(combinedIndex, 1);
      if (finding.type === 'labeled-issue') analysis.coverage.issueFindingsProduced -= 1;
      else {
        analysis.coverage.documentationFindingsProduced -= 1;
        analysis.coverage.documentationFindingsOmitted += 1;
      }
    }
    const groups = [analysis.labeledIssues];
    if (result.status === 'ready') {
      const snapshotAnalysis = result.snapshot.analysis;
      for (const group of [snapshotAnalysis.markdownLinks, snapshotAnalysis.npmScripts]) {
        const index = group.findings.findIndex(({ id }) => id === finding.id);
        if (index !== -1) {
          group.findings.splice(index, 1);
          group.coverage.findingsProduced -= 1;
          group.coverage.findingsOmitted += 1;
        }
      }
    }
    for (const group of groups) {
      const index = group.findings.findIndex(({ id }) => id === finding.id);
      if (index !== -1) {
        group.findings.splice(index, 1);
        group.coverage.findingsProduced -= 1;
        group.coverage.findingsOmitted += 1;
      }
    }
    omissions.findings += 1;
  };
  const uniqueFindings = [...new Map(findings.map((finding) => [finding.id, finding])).values()];
  for (const finding of uniqueFindings.sort((left, right) => jsonBytes(right) - jsonBytes(left))) {
    if (fits()) break;
    removeFinding(finding);
  }
  // This cannot occur for validated repository metadata and the bounded typed fields.
  if (!fits()) throw new ApplicationError(502, 'GITHUB_UPSTREAM_FAILURE', 'The analysis response could not be returned safely. Please try again later.');
  return result;
}
