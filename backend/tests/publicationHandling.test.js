'use strict';

const { PUBLICATION_TLP_LEVELS, normalizeLevel, buildPublicationHandling } = require('../src/utils/publicationHandling');

describe('publication handling metadata',()=>{
  test('accepts only FIRST TLP 2.0 levels and normalizes prefixed input',()=>{
    expect(PUBLICATION_TLP_LEVELS).toEqual(['CLEAR','GREEN','AMBER','AMBER+STRICT','RED']);
    expect(normalizeLevel('tlp: amber + strict')).toBe('AMBER+STRICT');
    for(const level of PUBLICATION_TLP_LEVELS){
      expect(buildPublicationHandling({level,actorId:'analyst-1',now:new Date('2026-10-26T12:00:00.000Z')}))
        .toMatchObject({scheme:'FIRST_TLP_2_0',level,label:'TLP:'+level,set_by:'analyst-1',set_at:'2026-10-26T12:00:00.000Z'});
    }
  });

  test('rejects unsupported, guessed, and empty handling levels',()=>{
    for(const level of ['CONFIDENTIAL','INTERNAL','TLP:WHITE','',null,undefined]){
      expect(()=>buildPublicationHandling({level})).toThrow('Choose a supported FIRST TLP 2.0 handling level.');
    }
  });
});
