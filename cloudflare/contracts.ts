import type {Project} from '../src/data';
export type CandidateStatus='pending_review'|'published'|'rejected';
export type Provenance='seed'|'github'|'synthetic';
export interface RepositoryMetadata {avatar:string;ownerLogin:string;ownerType:string;ownerId:number;ownerUrl:string;avatarUrl:string;stars:number;forks:number;fetchedAt:string;repositoryUrl:string;metadataApiSource:string;}
export interface CandidateInput {id:string;repository:string;project:Project;metadata:RepositoryMetadata;sourceUrls:string[];provenance:Provenance;}
export interface Candidate extends CandidateInput {revision:number;status:CandidateStatus;updatedAt:string;}
export interface PublishedProject extends CandidateInput {revision:number;publishedAt:string;}
export interface Env {DB:D1Database;ASSETS?:Fetcher;ADMIN_AUTH?:Fetcher;GITHUB_FETCH?:Fetcher;APP_ORIGIN?:string;COLLECTION_ENABLED?:string;}
export interface Principal {id:string;role:'collector'|'reviewer';}
