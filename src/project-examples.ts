import type {Project} from './data';

// Source-backed local card examples, not running third-party integrations.
// Editorial scenarios are illustrative. Source documentation retains limitations.
export const projectExamples:Project[] = [
 {id:'dsbot',name:'DS-Bot-App',owner:'QingJ01 / DS-Bot-App',category:'效率',tagline:'Bot 团队远程控制',description:'用于 DeepSeek Harness 的社区应用，在手机续接电脑上的 Bot 团队。',tags:['团队群聊','多模型','手机控制'],url:'https://github.com/QingJ01/DS-Bot-App',use:'在电脑上安排多个 Bot 分工，离开电脑后用手机延续同一团队会话。',points:['每个 Bot 可分别配置模型、MCP 和 Skills','手机与电脑共享会话，查看任务进度与工具结果','在手机上处理待审批操作'],art:'DS-Bot',symbol:'',bg:'#F6F8FA',ink:'#0969DA'},
 {id:'harness',name:'deepseek-harness',owner:'deepseek-ai / deepseek-harness',category:'AI',tagline:'AI Agent 运行环境',description:'可替换运行组件的 Agent 框架，支持 DeepSeek 及其他模型。',tags:['插件架构','Creator','多模型'],url:'https://github.com/deepseek-ai/deepseek-harness',use:'将内部业务工具接入 Agent，再让它结合项目文件处理实际任务。',points:['模型适配、工具注册、会话日志与 Agent loop 均是可替换插件','通过 Creator 对话创建插件，接入自己的工具与流程','Agent 可读写工作区文件、执行命令和委派子任务'],art:'Harness',symbol:'',bg:'#F6F8FA',ink:'#0969DA'},
 {id:'ombre',name:'Ombre-Brain',owner:'P0luz / Ombre-Brain',category:'AI',tagline:'Agent 长期情绪记忆',description:'通过 MCP 为 Agent 保存经历和情绪标注，并在后续对话中检索。',tags:['情绪权重','记忆衰减','MCP'],url:'https://github.com/P0luz/Ombre-Brain',use:'长期与写作 Agent 合作时，保存创作中的情绪、取舍与偏好，后续按需检索。',points:['用情绪坐标标注记忆，并结合情绪权重与衰减管理保留','支持关键词与语义混合检索','记忆以 Obsidian 兼容的 Markdown 文件保存'],art:'Ombre',symbol:'',bg:'#F6F8FA',ink:'#0969DA'},
];
export interface ExampleScenario {heading:string; capabilities:[string,string]; useCase:string; source:string}
export const exampleScenarios:Record<string,ExampleScenario> = {
 dsbot:{heading:'Bot 团队远程控制',capabilities:['每个 Bot 可单独配置模型、MCP 和 Skills，在同一群聊中分工。','手机延续电脑端会话，查看任务与工具结果，并批准或拒绝待处理操作。'],useCase:'电脑上让两个 Bot 分别整理资料、核对方案。离开电脑后，用手机回到同一团队群聊，查看两边结果、补充要求，再确认待审批操作。',source:'https://github.com/QingJ01/DS-Bot-App#readme'},
 harness:{heading:'AI Agent 运行环境',capabilities:['模型适配、工具注册、会话日志，乃至 Agent 循环，都能通过插件替换。','可与 Creator 对话创建插件，把自定义工具接进 Agent 工作流。'],useCase:'团队有内部工单接口，想让 Agent 查工单并处理代码。可用 Creator 创建对接插件，再让 Agent 围绕工单读取仓库、修改文件并执行检查。',source:'https://github.com/deepseek-ai/deepseek-harness#readme'},
 ombre:{heading:'Agent 长期情绪记忆',capabilities:['情绪强烈、尚未解决的记忆权重更高；不活跃的记忆逐渐衰减并归档。','支持关键词与语义检索；记忆保存为 Obsidian 兼容的 Markdown 文件。'],useCase:'和写作 Agent 长期合作，记录卡稿时的焦虑、改稿后的满意，以及为何删掉某个结局。下次讨论相似章节时，检索这段经历，把当时的感受与取舍一起带回对话。',source:'https://github.com/P0luz/Ombre-Brain#readme'},
};
