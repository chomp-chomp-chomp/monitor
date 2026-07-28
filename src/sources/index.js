import * as nlrb from './nlrb.js';

// Each source module must export: id, label, and
// fetchFilings({ seenCaseNumbers }) -> Promise<Record[]>
// where Record = { source, sourceLabel, caseName, caseNumber, dateFiled,
//                   caseType, status, location, region, url }
export const sources = [nlrb];
