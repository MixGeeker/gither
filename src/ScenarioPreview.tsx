import type {ScenarioContent} from './card-content';
export default function ScenarioPreview({scenario:s}:{scenario:ScenarioContent}){
 return <section className="scenario-preview" aria-label="项目能力与编辑整理的场景示例，非第三方实际运行结果">
   <dl>
     <dt>核心能力</dt>
     <dd className="scenario-capabilities">{s.capabilities.map(text=><p key={text}>{text}</p>)}</dd>
     <dt>场景示例</dt>
     <dd>{s.useCase}</dd>
   </dl>
 </section>;
}
