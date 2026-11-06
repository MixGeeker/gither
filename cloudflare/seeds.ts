import {projectExamples, exampleScenarios} from '../src/project-examples';
import githubMetadata from '../src/github-metadata.json';
import type {CandidateInput, RepositoryMetadata} from './contracts';
import {candidateInsert, normalizeCandidate} from './store';

const metadata = githubMetadata as Record<string, RepositoryMetadata>;

/** Source-backed local examples, not production traffic or human feedback. */
export function seedInputs():CandidateInput[] {
  return projectExamples.map(project => {
    const repositoryMetadata = metadata[project.id];
    const scenario = exampleScenarios[project.id];
    if (!repositoryMetadata || !scenario) throw new Error('Missing verified seed source');
    return normalizeCandidate({
      id:project.id,
      repository:project.url.slice('https://github.com/'.length),
      project,
      metadata:repositoryMetadata,
      sourceUrls:[project.url, repositoryMetadata.metadataApiSource, scenario.source],
      provenance:'seed',
    });
  });
}

export async function seedCatalog(db:D1Database):Promise<{changed:number}> {
  const statements = await Promise.all(seedInputs().map(input => candidateInsert(db, input, false)));
  const results = await db.batch(statements);
  return {changed:results.reduce((sum, result) => sum + result.meta.changes, 0)};
}
