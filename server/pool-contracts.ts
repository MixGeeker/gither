export type VerifiedPrincipal = { userId: string; keyId: string; scopes: string[] };
export type Decision = 'saved' | 'dismissed' | 'none';
export type ReviewDecision = 'approved' | 'rejected';
export interface Evidence { url: string; claim: string }
export interface CandidateDraft {
  repositoryUrl: string; title: string; purpose: string; description: string;
  capabilities: string[]; useCase: string; tags: string[]; evidence: Evidence[];
  stars?: number; language?: string;
}
export interface PoolRules { refillThreshold: number; batchTarget: number; version: number }
export interface Flavor { id: string; label: string; weight: number }
export interface DiscoveryProfile {
  version: number; topics: string[]; sources: string[]; flavors: Flavor[]; excludedTopics: string[];
}
export type ProfileInput = Omit<DiscoveryProfile, 'version'> & { expectedVersion?: number };
export interface Subscription { id: string; label: string; query: string; enabled: boolean }
export interface CandidateRecord extends CandidateDraft {
  id: string; canonicalRepository: string; status: 'pending' | ReviewDecision;
  createdAt: number; jobId: string | null; reviewNote: string | null;
}
export interface ProjectCard extends CandidateDraft {
  id: string; candidateId: string; canonicalRepository: string;
  publishedAt: number; available: boolean; decision: Decision;
}
export interface FeedbackSignal { tag: string; saved: number; dismissed: number; samples: number; score: number; evidence: 'insufficient' | 'repeated'; explanation: string }
export interface FeedbackSuggestion { tag: string; direction: 'more' | 'less'; samples: number; explanation: string; requiresHumanApproval: true }
export interface FeedbackSnapshot { signals: FeedbackSignal[]; suggestions: FeedbackSuggestion[]; humanRulesOverride: true }
export interface FlavorTarget { id: string; label: string; weight: number; candidateTarget: number }
export type JobState = 'queued' | 'leased' | 'backoff' | 'completed' | 'failed';
export interface CollectionJob {
  id: string; status: JobState; batchTarget: number; assessedCount: number; pendingCount: number;
  attempt: number; maxAttempts: number; createdAt: number; updatedAt: number;
  nextAttemptAt: number; leaseExpiresAt: number | null; claimedByKeyId: string | null;
  rulesSnapshot: PoolRules; profileSnapshot: DiscoveryProfile; subscriptionsSnapshot: Subscription[];
  flavorTargets: FlavorTarget[]; feedbackSnapshot: FeedbackSnapshot;
  summary: string | null;
}
export interface JobClaim { job: CollectionJob; claimToken: string }
export interface ClaimInput { idempotencyKey: string }
export interface BoundClaim { jobId: string; claimToken: string }
export interface FinishInput extends BoundClaim { outcome: 'completed' | 'failed'; summary?: string }
export interface SubmitInput extends BoundClaim { idempotencyKey: string; candidates: CandidateDraft[] }
export interface SubmitResult {
  jobId: string; assessedCount: number; target: number; remaining: number;
  results: { repositoryUrl: string; canonicalRepository: string; candidateId: string | null; outcome: 'pending' | 'duplicate' }[];
}
export interface PoolStatus {
  availableCount: number; pendingCount: number; savedCount: number; dismissedCount: number;
  rules: PoolRules; profileVersion: number; activeJob: CollectionJob | null; nextCollectionAt: number | null;
}
export interface PoolOptions {
  now?: () => number; leaseMs?: number; maxAttempts?: number; baseBackoffMs?: number; collectionCooldownMs?: number;
}
export class PoolError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'PoolError'; }
}
