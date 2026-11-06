import {useCallback,useEffect,useState} from 'react';
import DemoApp from './App';
import AuthPanel from './AuthPanel';
import SelfHostedApp from './SelfHostedApp';
import {api,ApiError,errorText,type SessionUser} from './api';

const requiredSelfHosted=import.meta.env.VITE_SELF_HOSTED==='true';
type Gate={kind:'loading'}|{kind:'demo'}|{kind:'setup'}|{kind:'signin'}|{kind:'ready';user:SessionUser}|{kind:'error';message:string};
export default function Root(){
  const[gate,setGate]=useState<Gate>({kind:'loading'});const[attempt,setAttempt]=useState(0);
  const signedOut=useCallback(()=>setGate({kind:'signin'}),[]);
  useEffect(()=>{window.addEventListener('gither:session-expired',signedOut);return()=>window.removeEventListener('gither:session-expired',signedOut)},[signedOut]);
  useEffect(()=>{
    const controller=new AbortController();let live=true;
    async function check(){
      setGate({kind:'loading'});
      let system:{selfHosted:boolean;initialized:boolean};
      try{system=await api('/api/system',{signal:controller.signal,sessionCheck:true})}
      catch(error){if(!live)return;if(!requiredSelfHosted&&error instanceof ApiError&&([404,405].includes(error.status)||error.code==='NOT_JSON')){setGate({kind:'demo'});return}setGate({kind:'error',message:errorText(error)});return}
      if(!live)return;
      if(system.selfHosted!==true){setGate(requiredSelfHosted?{kind:'error',message:'此构建需要自托管 API，无法读取服务器状态。'}:{kind:'demo'});return}
      if(!system.initialized){setGate({kind:'setup'});return}
      try{const session=await api<{user:SessionUser}|null>('/api/auth/get-session',{signal:controller.signal,sessionCheck:true});if(live)setGate(session?.user?{kind:'ready',user:session.user}:{kind:'signin'})}
      catch(error){if(live)setGate(error instanceof ApiError&&error.status===401?{kind:'signin'}:{kind:'error',message:errorText(error)})}
    }
    void check();return()=>{live=false;controller.abort()};
  },[attempt]);
  if(gate.kind==='demo')return <DemoApp/>;
  if(gate.kind==='ready')return <SelfHostedApp key={gate.user.id} user={gate.user} onSignOut={signedOut}/>;
  return <main className="auth-gate"><div className="gate-card"><div className="gate-brand">Gither <span>自托管</span></div>{gate.kind==='loading'?<p role="status">正在连接账号服务…</p>:gate.kind==='setup'?<><h1>先创建管理员账号</h1><p>此实例尚未初始化。请在服务器终端运行以下命令，按提示设置邮箱和密码。</p><pre>docker compose run --rm -it app setup</pre><p className="field-hint">直接运行 Node 的部署可使用 npm run setup。这里没有公开注册入口，请勿在聊天或配置文件中填入密码。</p><button className="primary" onClick={()=>setAttempt(x=>x+1)}>已完成，重新检查</button></>:gate.kind==='error'?<><h1>暂时无法连接</h1><p className="form-error" role="alert">{gate.message}</p><p>私人项目、收藏和设置需要有效的服务器会话。连接恢复后再继续。</p><button className="primary" onClick={()=>setAttempt(x=>x+1)}>重新连接</button></>:<AuthPanel onSignedIn={user=>setGate({kind:'ready',user})}/>}</div></main>;
}
