import {projectExamples,exampleScenarios} from '../src/project-examples';
import type {CandidateDraft} from './pool-contracts.js';
/** Explicitly imported editorial examples. These enter pending review, never fake organic activity. */
export function exampleCandidates():CandidateDraft[]{return projectExamples.map(p=>({repositoryUrl:p.url,title:p.name,purpose:p.tagline,description:p.description,capabilities:exampleScenarios[p.id]!.capabilities,useCase:exampleScenarios[p.id]!.useCase,tags:p.tags,evidence:[{url:exampleScenarios[p.id]!.source,claim:'Editorial example based on the official repository documentation, not a measured product result.'}]}));}
