export interface PoolRules {refillThreshold:number;batchTarget:number;version:number}
export interface Flavor {id:string;label:string;weight:number}
export interface DiscoveryProfile {version:number;topics:string[];sources:string[];flavors:Flavor[];excludedTopics:string[]}
export interface CandidateRecord {id:string;repositoryUrl:string;canonicalRepository:string;title:string;purpose:string;description:string;capabilities:string[];useCase:string;tags:string[];evidence:{url:string;claim:string}[];stars?:number;language?:string;status:'pending'|'approved'|'rejected';createdAt:number;jobId:string|null;reviewNote:string|null}
export interface CollectionJob {id:string;status:'queued'|'leased'|'backoff'|'completed'|'failed';batchTarget:number;assessedCount:number;pendingCount:number;attempt:number;maxAttempts:number;createdAt:number;updatedAt:number;nextAttemptAt:number;leaseExpiresAt:number|null;profileSnapshot:DiscoveryProfile;rulesSnapshot:PoolRules;summary:string|null}
export interface PoolStatus {availableCount:number;pendingCount:number;savedCount:number;dismissedCount:number;rules:PoolRules;profileVersion:number;activeJob:CollectionJob|null;nextCollectionAt:number|null}
export function listItems<T>(value:T[]|Record<string,T[]>,key:string):T[]{if(Array.isArray(value))return value;if(value&&Array.isArray(value[key]))return value[key];throw new Error('列表格式无效，请刷新重试。')}
export const dateLabel=(value:string|number|null|undefined)=>value==null?'—':Number.isNaN(new Date(value).getTime())?'—':new Date(value).toLocaleString('zh-CN');

export type PoolProposal = {id:string;createdAt:number}&({kind:'collection_plan';payload:{rationale:string;queries:string[]}}|{kind:'subscriptions';payload:{id:string;label:string;query:string;enabled:boolean}[]});
