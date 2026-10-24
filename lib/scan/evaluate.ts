import { buildChecklist } from "../checklist";
import type { ChecklistItem, Coverage, Gap } from "../types";
import { runEngine, type EngineInput } from "./engine";

/**
 * Engine + checklist in one step. T9 (DB checks) calls this to re-evaluate a stored scan with new dbFindings:
 *   engineFromFindings({ frameworks, codeFindings, schemaFindings, dbFindings, claims, coverage: { ...coverage, liveDb: true } })
 * runScan stores code signals at scans.coverage.signals; pass them back as `signals` when re-evaluating.
 */
export function engineFromFindings(input: EngineInput & { coverage: Coverage }): { gaps: Gap[]; checklist: ChecklistItem[] } {
  const gaps = runEngine(input);
  const checklist = buildChecklist(input.frameworks, gaps, input.coverage);
  return { gaps, checklist };
}
