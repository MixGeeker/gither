import {useRef,useState,type CSSProperties} from 'react';
import type {Project} from './data';
import {covers,coverIcons} from './covers';
import Icon from './Icon';
import ScenarioPreview from './ScenarioPreview';
import {runtimeScenario,ownerAvatar} from './card-content';
import {exampleScenarios} from './project-examples';
import githubMetadata from './github-metadata.json';
import {decisionForRelease,directionalStrength,exitOffset,type Decision} from './motion';
export type Entrance='next'|'undo-save'|'undo-dismiss';
interface Props {live?:boolean;p:Project;remaining:number;onAction:(action:Decision)=>void;onDetail:()=>void;busy:boolean;exit?:Decision|null;entrance?:Entrance|null;onDrag?:(strength:number)=>void;reducedMotion?:boolean;preview?:boolean}
const compact=(n:number)=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n);
export default function ProjectCard({p,remaining,onAction,onDetail,busy,exit=null,entrance=null,onDrag,reducedMotion=false,preview=false,live=false}:Props){
  const[drag,setDrag]=useState(0);
  const[avatarFailed,setAvatarFailed]=useState(false);
  const cardRef=useRef<HTMLElement>(null);
  const[dragging,setDragging]=useState(false);
  const origin=useRef<{x:number;y:number;lastX:number;lastTime:number;offset:number;velocity:number;locked:boolean}|null>(null);
  const meta=live?p.metadata:githubMetadata[p.id as keyof typeof githubMetadata];
  const repo=meta?.repositoryUrl.split('/').pop()||p.name;
  const cover=live?{heading:p.tagline||p.name,steps:(p.card?.capabilities.length?p.card.capabilities:p.points).slice(0,3)}:(covers[p.id]||{heading:p.tagline||p.name,steps:p.points.slice(0,3)});
  const scenario=live?runtimeScenario(p):exampleScenarios[p.id];
  const avatar=live?ownerAvatar(p,githubMetadata):meta?.avatar;
  const reset=()=>{origin.current=null;setDragging(false);setDrag(0);onDrag?.(0)};
  const target=exit?exitOffset(exit,drag,window.innerWidth,cardRef.current?.offsetWidth||window.innerWidth):drag;
  const angle=reducedMotion?0:exit?(exit==='save'?12:-12):Math.max(-12,Math.min(12,drag/24));
  const transform=reducedMotion&&exit?'none':target?`translate3d(${target}px,0,0) rotate(${angle}deg)`:'none';
  return <article ref={cardRef} className={`project-card swipe-card ${scenario?'has-scenario':''} ${dragging&&!exit?'is-dragging':''} ${exit?'is-exiting':''} ${entrance?`enter-${entrance}`:''}`} aria-label={`${p.name} 项目`}
    style={{transform,'--return-x':`${exitOffset(entrance==='undo-dismiss'?'dismiss':'save',0,window.innerWidth,cardRef.current?.offsetWidth||window.innerWidth)}px`,'--return-rotation':entrance==='undo-dismiss'?'-12deg':'12deg'} as CSSProperties}
    onPointerDown={e=>{if(preview||(e.target as HTMLElement).closest('button,a')||e.button!==0||busy)return;origin.current={x:e.clientX,y:e.clientY,lastX:e.clientX,lastTime:e.timeStamp,offset:0,velocity:0,locked:false}}}
    onPointerMove={e=>{const o=origin.current;if(!o||busy)return;const dx=e.clientX-o.x,dy=e.clientY-o.y;if(!o.locked&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>12){reset();return}if(!o.locked&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){o.locked=true;e.currentTarget.setPointerCapture(e.pointerId);setDragging(true)}if(!o.locked)return;const dt=e.timeStamp-o.lastTime;if(dt>0)o.velocity=(e.clientX-o.lastX)/dt;o.lastX=e.clientX;o.lastTime=e.timeStamp;o.offset=dx;setDrag(dx);onDrag?.(directionalStrength(dx))}}
    onPointerUp={e=>{const o=origin.current;if(!o)return;const decision=o.locked?decisionForRelease(o.offset,e.timeStamp-o.lastTime<100?o.velocity:0):null;origin.current=null;setDragging(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(decision)onAction(decision);else{setDrag(0);onDrag?.(0)}}}
    onPointerCancel={reset} onLostPointerCapture={()=>{if(origin.current)reset()}}>
    <div className="card-reader" tabIndex={0} aria-label={`${p.name} 项目介绍，可上下滚动`}>
      <section className="word-cover" aria-label="根据项目用途制作的文字封面，不是产品截图">
        <div className="code-rain" aria-hidden="true">{Array.from({length:16},(_,i)=><span key={i} style={{'--column':i,'--fall':`${20+i%7}s`,'--delay':`${-(i*1.7)}s`} as CSSProperties}>{['01{}0101();=>010{}10','git|01<>010010{}[]','1010const{}01=>01','01[]0110return{}'][i%4]}</span>)}</div>
        <div className="cover-meta"><span>{p.category}</span><span>剩余 {remaining}</span></div>
        <h3 className="cover-purpose">{cover.heading.split('\n').map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h3>
        <p className="project-description">{p.description}</p>
        {scenario?<ScenarioPreview scenario={scenario}/>:<figure className="cover-diagram" aria-label="原创功能示意，不是产品截图"><div className="diagram-steps">{cover.steps.map((step,i)=><div className="diagram-step" key={step}><Icon name={(live?undefined:coverIcons[p.id]?.[i])||(['info','nodes','code'] as const)[i%3]} size={34}/><span>{step}</span></div>)}</div><figcaption>功能示意</figcaption></figure>}
      </section>
      <section className="card-summary" aria-label="项目技术与详情">
        <div className="summary-meta"><p className="technology-line">{p.tags.join(' · ')}</p><span className="sample-note">{live?'已审核摘要':scenario?'场景示意 · 非运行结果':'示例摘要'}</span></div>
        <button className="detail-button" onClick={onDetail}><span>详情</span><Icon name="chevron" size={18}/></button>
      </section>
    </div>
    <footer className="repository-footer">
      <a className="repository-identity" href={meta?.repositoryUrl||p.url} target="_blank" rel="noopener noreferrer" aria-label={`GitHub 仓库 ${meta?.ownerLogin||p.owner} / ${repo}`} title="访问 GitHub 仓库">
        {avatar&&!avatarFailed?<img className="owner-avatar" src={avatar} alt={`${meta?.ownerLogin||p.owner.split('/')[0].trim()} 的 GitHub 头像`} onError={()=>setAvatarFailed(true)}/>:<span className="owner-avatar avatar-fallback" aria-label="头像不可用，显示首字母">{(meta?.ownerLogin||p.name).slice(0,1).toUpperCase()}</span>}
        <span className="repository-path"><span>{meta?.ownerLogin||p.owner.split('/')[0].trim()}</span><span className="repository-name"><Icon name="repo" size={17}/>{repo}</span></span><Icon name="external" size={19}/>
      </a>
      <div className="repository-metrics"><span title={meta?.stars!==undefined?`${meta.stars.toLocaleString()} stars`:'统计不可用'} aria-label={meta?.stars!==undefined?`${meta.stars} stars`:'star 统计不可用'}><Icon name="star" size={18}/>{meta?.stars!==undefined?compact(meta.stars):'—'}</span><span title={meta?.forks!==undefined?`${meta.forks.toLocaleString()} forks`:'统计不可用'} aria-label={meta?.forks!==undefined?`${meta.forks} forks`:'fork 统计不可用'}><Icon name="fork" size={18}/>{meta?.forks!==undefined?compact(meta.forks):'—'}</span><a className="snapshot-link" href={meta?.metadataApiSource||p.url} target="_blank" rel="noopener noreferrer" title={meta?.fetchedAt?`GitHub API 快照 ${meta.fetchedAt}`:'统计不可用'}>{meta?.fetchedAt?`快照 ${meta.fetchedAt.slice(0,10)}`:'暂无统计'}<Icon name="external" size={12}/></a></div>
    </footer>
  </article>
}
