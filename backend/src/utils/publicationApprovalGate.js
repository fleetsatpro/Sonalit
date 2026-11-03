'use strict';

function publicationApprovalBlockers(publication) {
  const body = publication?.body && typeof publication.body === 'object' ? publication.body : {};
  const gate = body.release_gate && typeof body.release_gate === 'object' ? body.release_gate : {};
  const blockers = [];
  if (gate.research_release_gate !== true) {
    blockers.push({ code: 'research_release_gate_not_passed', message: 'Research release gate is not recorded as passed.' });
  }
  if (gate.tradecraft_quality_gate !== true || body.publication_quality?.passed !== true) {
    blockers.push({ code: 'tradecraft_quality_gate_not_passed', message: 'Tradecraft quality gate is not recorded as passed.' });
  }
  if (gate.ai_board_gate !== true) {
    blockers.push({ code: 'ai_board_gate_not_passed', message: 'Editorial board gate is not recorded as passed.' });
  }
  const evidenceMet = body.generator?.evidence_contract === true ||
    body.collection_basis?.publication_evidence_contract_met === true;
  if (!evidenceMet) {
    blockers.push({ code: 'evidence_contract_not_met', message: 'Publication evidence contract is not recorded as met.' });
  }
  return blockers;
}

module.exports = { publicationApprovalBlockers };
