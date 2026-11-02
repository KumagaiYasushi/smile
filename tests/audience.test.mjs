import assert from 'node:assert/strict';
import test from 'node:test';
import {allAudienceRoles,parseAudienceRoles,audienceText,audienceFromLegacy} from '../types/audience.ts';
test('audience starts with all roles and validates nonempty unique choices in a stable order',()=>{
  assert.deepEqual(allAudienceRoles(),['dental_hygienist','dentist','other']);
  assert.deepEqual(parseAudienceRoles(['dentist','dental_hygienist']),['dental_hygienist','dentist']);
  assert.equal(audienceText(parseAudienceRoles(['other','dentist'])),'歯科医師・その他');
  for(const value of [null,[],['dentist','dentist'],['toString'],['unknown'],'dentist'])assert.throws(()=>parseAudienceRoles(value),{status:400});
  assert.deepEqual(audienceFromLegacy('歯科衛生士、歯科医師'),['dental_hygienist','dentist']);
  assert.equal(audienceFromLegacy('旧来の自由記載対象'),null);
});
