import {useRef,useState,type CSSProperties} from 'react';
import type {Project} from './data';
import {covers,coverIcons} from './covers';
import Icon from './Icon';
import githubMetadata from './github-metadata.json';
interface Props {p:Project;remaining:number;onAction:(action:'save'|'dismiss')=>void;onDetail:()=>void;busy:boolean}
const compact=(n:number)=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n);
export default function ProjectCard({p,remaining,onAction,onDetail,busy}:Props){
  const[drag,setDrag]=useState(0);
  const[avatarFailed,setAvatarFailed]=useState(false);
  const origin=useRef<{x:number;y:number}|null>(null);
  const meta=githubMetadata[p.id as keyof typeof githubMetadata];
  const repo=meta?.repositoryUrl.split('/').pop()||p.name;
  const cover=covers[p.id];
  const reset=()=>{origin.current=null;setDrag(0)};
  return <article className="project-card" aria-label={`${p.name} 项目`}
    style={{transform:drag?`translateX(${drag}px) rotate(${drag/24}deg)`:undefined,transition:origin.current?'none':undefined}}
    onPointerDown={e=>{if((e.target as HTMLElement).closest('button,a')||e.button!==0||busy)return;origin.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId)}}
    onPointerMove={e=>{if(!origin.current)return;const dx=e.clientX-origin.current.x,dy=e.clientY-origin.current.y;if(Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>12){reset();return}if(Math.abs(dx)>8)setDrag(dx)}}
    onPointerUp={()=>{if(origin.current&&Math.abs(drag)>82)onAction(drag>0?'save':'dismiss');reset()}} onPointerCancel={reset}>
    <span className="swipe-label yes" aria-hidden="true" style={{opacity:drag>0?Math.min(drag/82,1):0}}>收藏</span>
    <span className="swipe-label no" aria-hidden="true" style={{opacity:drag<0?Math.min(-drag/82,1):0}}>略过</span>
    <div className="card-reader" tabIndex={0} aria-label={`${p.name} 项目介绍，可上下滚动`}>
      <section className="word-cover" aria-label="根据项目用途制作的文字封面，不是产品截图">
        <div className="code-rain" aria-hidden="true">{Array.from({length:16},(_,i)=><span key={i} style={{'--column':i,'--fall':`${20+i%7}s`,'--delay':`${-(i*1.7)}s`} as CSSProperties}>{['01{}0101();=>010{}10','git|01<>010010{}[]','1010const{}01=>01','01[]0110return{}'][i%4]}</span>)}</div>
        <div className="cover-meta"><span>{p.category}</span><span>剩余 {remaining}</span></div>
        <h3 className="cover-purpose">{cover.heading.split('\n').map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h3>
        <p className="project-description">{p.description}</p>
        <figure className="cover-diagram" aria-label="原创功能示意，不是产品截图"><div className="diagram-steps">{cover.steps.map((step,i)=><div className="diagram-step" key={step}><Icon name={coverIcons[p.id][i]} size={34}/><span>{step}</span></div>)}</div><figcaption>功能示意</figcaption></figure>
      </section>
      <section className="card-summary" aria-label="项目技术与详情">
        <div className="summary-meta"><p className="technology-line">{p.tags.join(' · ')}</p><span className="sample-note">示例摘要</span></div>
        <button className="detail-button" onClick={onDetail}><span>详情</span><Icon name="chevron" size={18}/></button>
      </section>
    </div>
    <footer className="repository-footer">
      <a className="repository-identity" href={meta?.repositoryUrl||p.url} target="_blank" rel="noopener noreferrer" aria-label={`GitHub 仓库 ${meta?.ownerLogin||p.owner} / ${repo}`} title="访问 GitHub 仓库">
        {meta&&!avatarFailed?<img className="owner-avatar" src={meta.avatar} alt={`${meta.ownerLogin} 的 GitHub 头像`} onError={()=>setAvatarFailed(true)}/>:<span className="owner-avatar avatar-fallback" aria-label="头像不可用，显示首字母">{(meta?.ownerLogin||p.name).slice(0,1).toUpperCase()}</span>}
        <span className="repository-path"><span>{meta?.ownerLogin||p.owner.split('/')[0].trim()}</span><span className="repository-name"><Icon name="repo" size={17}/>{repo}</span></span><Icon name="external" size={19}/>
      </a>
      <div className="repository-metrics"><span title={meta?`${meta.stars.toLocaleString()} stars`:'统计不可用'} aria-label={meta?`${meta.stars} stars`:'star 统计不可用'}><Icon name="star" size={18}/>{meta?compact(meta.stars):'—'}</span><span title={meta?`${meta.forks.toLocaleString()} forks`:'统计不可用'} aria-label={meta?`${meta.forks} forks`:'fork 统计不可用'}><Icon name="fork" size={18}/>{meta?compact(meta.forks):'—'}</span><a className="snapshot-link" href={meta?.metadataApiSource||p.url} target="_blank" rel="noopener noreferrer" title={meta?`GitHub API 快照 ${meta.fetchedAt}`:'统计不可用'}>{meta?`快照 ${meta.fetchedAt.slice(0,10)}`:'暂无统计'}<Icon name="external" size={12}/></a></div>
    </footer>
  </article>
}
