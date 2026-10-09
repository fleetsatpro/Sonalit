'use strict';

const { publicationApprovalBlockers } = require('../src/utils/publicationApprovalGate');
const fs = require('fs');
const path = require('path');

const passingPublication = {
  status: 'review',
  body: {
    release_gate: {
      research_release_gate: true,
      tradecraft_quality_gate: true,
      ai_board_gate: true
    },
    publication_quality: { passed: true, score: 96 },
    generator: { evidence_contract: true }
  }
};

describe('publication approval fail-closed release gate', () => {
  test('allows approval only when all persisted publication gates passed', () => {
    expect(publicationApprovalBlockers(passingPublication)).toEqual([]);
  });

  test('blocks approval if research is held', () => {
    const publication = structuredClone(passingPublication);
    publication.body.release_gate.research_release_gate = false;
    expect(publicationApprovalBlockers(publication).map(x => x.code)).toContain('research_release_gate_not_passed');
  });

  test('blocks approval if tradecraft or editorial review failed', () => {
    const publication = structuredClone(passingPublication);
    publication.body.release_gate.tradecraft_quality_gate = false;
    publication.body.publication_quality.passed = false;
    publication.body.release_gate.ai_board_gate = false;
    expect(publicationApprovalBlockers(publication).map(x => x.code)).toEqual([
      'tradecraft_quality_gate_not_passed',
      'ai_board_gate_not_passed'
    ]);
  });

  test('fails closed when legacy or incomplete rows lack gate metadata', () => {
    expect(publicationApprovalBlockers({ status: 'review', body: {} }).map(x => x.code)).toEqual([
      'research_release_gate_not_passed',
      'tradecraft_quality_gate_not_passed',
      'ai_board_gate_not_passed',
      'evidence_contract_not_met'
    ]);
  });

  test('the tenant-scoped review endpoint enforces blockers before recording approval', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/intelligenceOperations.js'), 'utf8');
    expect(source).toContain("SELECT id,status,body FROM intel_publications WHERE id=$1 AND org_id=$2");
    expect(source).toContain('const blockers=publicationApprovalBlockers(pub[0])');
    expect(source).toContain("error:'publication_release_gate_blocked'");
    expect(source.indexOf('const blockers=publicationApprovalBlockers(pub[0])')).toBeLessThan(
      source.indexOf('INSERT INTO intel_publication_reviews')
    );
  });
});
