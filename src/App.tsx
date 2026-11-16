import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  BarChart3, CalendarClock, ChevronRight, FileText,
  Filter, LayoutDashboard, LogIn, LogOut, MapPinned,
  Plus, RefreshCcw, Search, ShieldCheck, X,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { STAGES, friendlyError } from './lib/types';
import type { Profile, Priority, Stage, Task } from './lib/types';
import { TaskModal } from './components/TaskModal';
import { MapView } from './components/MapView';
import { IntelligenceDashboard } from './components/IntelligenceDashboard';
import { MeetingsPage } from './components/MeetingsPage';

type Page = 'kanban'|'map'|'dashboard'|'meetings';
const formatDate=(value:string|null)=>value ? value.split('-').reverse().join('/') : 'Sem prazo';
const todayLocal=()=>{const d=new Date();const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const isLate=(t:Task)=>!!(t.due_date && t.due_date < todayLocal() && t.stage!=='Concluído');
const stageClass=(stage:Stage)=>STAGES.indexOf(stage);

export default function App(){
  const [session,setSession]=useState<Session|null>(null);
  const [sessionLoading,setSessionLoading]=useState(true);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [loading,setLoading]=useState(false);
  const [page,setPage]=useState<Page>('kanban');
  const [search,setSearch]=useState('');
  const [priority,setPriority]=useState<Priority|'Todas'>('Todas');
  const [selected,setSelected]=useState<Task|null>(null);
  const [createStage,setCreateStage]=useState<Stage>('Backlog');
  const [modalOpen,setModalOpen]=useState(false);
  const [notice,setNotice]=useState('');
  const [mobileMenu,setMobileMenu]=useState(false);
  const notify=useCallback((message:string)=>setNotice(message),[]);
  const onTaskSaved=useCallback((saved:Task)=>{
    setTasks(old=>old.some(t=>t.id===saved.id)?old.map(t=>t.id===saved.id?saved:t):[saved,...old]);
    setSelected(saved);setModalOpen(true);
  },[]);
  const fetchTasks=useCallback(async()=>{
    setLoading(true);
    try{const {data,error}=await supabase.from('tasks').select('*').order('updated_at',{ascending:false}).limit(1000);
      if(error)throw error;setTasks((data||[]) as Task[]);
    }catch(err){notify(friendlyError(err));}finally{setLoading(false);}
  },[notify]);
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session:s}})=>{setSession(s);setSessionLoading(false);})
      .catch(()=>setSessionLoading(false));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>setSession(s));
    return ()=>subscription.unsubscribe();
  },[]);
  useEffect(()=>{
    setProfile(null);setTasks([]);
    if(!session)return;
    let alive=true;
    supabase.from('profiles').select('id,display_name,role,is_active').eq('id',session.user.id).single()
      .then(({data,error})=>{if(!alive)return;if(error)notify(error.message);else setProfile(data as Profile);});
    return ()=>{alive=false;};
  },[session?.user.id,notify]);
  useEffect(()=>{
    if(!session||!profile?.is_active)return;
    fetchTasks();
    const channel=supabase.channel('kanban-live-'+session.user.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},async(event)=>{
        const item=event.new as Partial<Task>;
        if(event.eventType==='DELETE'){
          const id=(event.old as {id:string}).id;setTasks(old=>old.filter(t=>t.id!==id));return;
        }
        if(!item.id)return;
        const {data,error}=await supabase.from('tasks').select('*').eq('id',item.id).maybeSingle();
        if(!error&&data)setTasks(old=>old.some(t=>t.id===data.id)?old.map(t=>t.id===data.id?data as Task:t):[data as Task,...old]);
      }).subscribe();
    return ()=>{void supabase.removeChannel(channel);};
  },[session?.user.id,profile?.is_active,fetchTasks]);
  const filtered=useMemo(()=>{
    const q=search.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return tasks.filter(t=>{
      const text=[t.title,t.description,t.neighborhood,t.city,t.responsible,t.organization,t.number].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
      return (!q||text.includes(q))&&(priority==='Todas'||t.priority===priority);
    });
  },[tasks,search,priority]);
  async function moveTask(task:Task,to:Stage){
    if(profile?.role==='viewer'||task.stage===to)return;
    const original=task;
    setTasks(old=>old.map(t=>t.id===task.id?{...t,stage:to}:t));
    const {data,error}=await supabase.from('tasks').update({stage:to}).eq('id',task.id).select('*').single();
    if(error){notify(error.message);setTasks(old=>old.map(t=>t.id===task.id?original:t));}
    else if(data)onTaskSavedIfOpened(data as Task);
  }
  function onTaskSavedIfOpened(updated:Task){
    setTasks(old=>old.map(t=>t.id===updated.id?updated:t));
    setSelected(old=>old?.id===updated.id?updated:old);
  }
  function create(stage:Stage='Backlog'){setSelected(null);setCreateStage(stage);setModalOpen(true);}
  if(sessionLoading)return <div className="full-center">Carregando acesso…</div>;
  if(!session)return <SignIn notify={notify} notice={notice}/>;
  if(!profile)return <div className="full-center"><div className="access-box"><ShieldCheck size={32}/><h2>Verificando permissões…</h2><p>Se esta tela permanecer, confirme se a migração SQL foi executada.</p><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sair</button></div></div>;
  if(!profile.is_active)return <div className="full-center"><div className="access-box"><ShieldCheck size={32}/><h2>Acesso pendente de aprovação</h2><p>Solicite ao administrador que ative sua conta e defina sua função (editor ou consulta).</p><p className="muted">ID da conta: {profile.id}</p><button className="secondary" onClick={()=>supabase.auth.signOut()}>Sair</button></div></div>;
  const canEdit=profile.role!=='viewer';
  return <div className="app-shell">
    <aside className={'sidebar '+(mobileMenu?'open':'')}>
      <div className="side-brand"><div className="brand-mark">NA</div><div><b>Núcleo de Articulação</b><small>Gabinete do Prefeito</small></div></div>
      <nav className="side-nav" aria-label="Navegação principal">
        <button className={page==='kanban'?'active':''} onClick={()=>{setPage('kanban');setMobileMenu(false);}}><LayoutDashboard size={19}/> Quadro Kanban <ChevronRight size={15}/></button>
        <button className={page==='dashboard'?'active':''} onClick={()=>{setPage('dashboard');setMobileMenu(false);}}><BarChart3 size={19}/> Indicadores <ChevronRight size={15}/></button>
        <button className={page==='map'?'active':''} onClick={()=>{setPage('map');setMobileMenu(false);}}><MapPinned size={19}/> Mapa de demandas <ChevronRight size={15}/></button>
        <button className={page==='meetings'?'active':''} onClick={()=>{setPage('meetings');setMobileMenu(false);}}><FileText size={19}/> Pautas e reuniões <ChevronRight size={15}/></button>
      </nav>
      <div className="side-footer"><div className="avatar">{profile.display_name.slice(0,2).toUpperCase()}</div><div><b>{profile.display_name}</b><small>{profile.role==='admin'?'Administrador':profile.role==='editor'?'Editor':'Consulta'}</small></div></div>
    </aside>
    {mobileMenu&&<div className="mobile-shade" onClick={()=>setMobileMenu(false)}/>}
    <div className="main-area">
      <header className="topbar">
        <button className="nav-toggle" onClick={()=>setMobileMenu(!mobileMenu)}>☰</button>
        <div className="top-title"><span>PAINEL DE DEMANDAS</span><small>São José do Rio Preto</small></div>
        <button title="Atualizar tarefas" className="top-icon" onClick={fetchTasks}><RefreshCcw size={19}/></button>
        <button title="Sair da conta" className="top-icon" onClick={()=>supabase.auth.signOut()}><LogOut size={19}/></button>
      </header>
      <main className="page">
        {page==='kanban'&&<>
          <div className="pane-heading"><div><div className="eyebrow">GESTÃO DE DEMANDAS</div><h1>Quadro Kanban</h1><p>Arraste os cartões entre etapas ou conclua o checklist para avanço automático.</p></div>
            {canEdit&&<button className="primary" onClick={()=>create()}><Plus size={18}/> Nova tarefa</button>}
          </div>
          <div className="toolbar"><div className="search-field"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pesquisar demanda, bairro, responsável..."/></div>
            <div className="select-wrap"><Filter size={17}/><select value={priority} onChange={e=>setPriority(e.target.value as Priority|'Todas')}><option>Todas</option><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></div>
            <span className="muted results">{loading?"Atualizando...":`${filtered.length} resultado(s)`}</span>
          </div>
          <div className="board">
            {STAGES.map(stage=><section className={'board-column stage-'+stageClass(stage)} key={stage}
              onDragOver={e=>{if(canEdit)e.preventDefault();}}
              onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('text/task-id');const task=tasks.find(x=>x.id===id);if(task)void moveTask(task,stage);}}>
              <div className="column-head"><span>{stage}</span><strong>{filtered.filter(t=>t.stage===stage).length}</strong></div>
              <div className="column-cards">
                {filtered.filter(t=>t.stage===stage).map(task=><article className={'task-card '+(isLate(task)?'late':'')} key={task.id} draggable={canEdit}
                  onDragStart={e=>e.dataTransfer.setData('text/task-id',task.id)} onClick={()=>{setSelected(task);setModalOpen(true);}}
                  role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'){setSelected(task);setModalOpen(true);}}}>
                  <div className="card-number">#{task.number} <span className={'priority '+task.priority.toLowerCase()}>{task.priority}</span></div>
                  <h3>{task.title}</h3>
                  {task.description&&<p>{task.description}</p>}
                  {task.neighborhood&&<small className="card-location"><MapPinned size={13}/>{task.neighborhood}</small>}
                  <div className="card-bottom"><span><CalendarClock size={14}/>{formatDate(task.due_date)}</span>{isLate(task)&&<span className="late-label">Em atraso</span>}</div>
                </article>)}
                {!filtered.some(t=>t.stage===stage)&&<div className="column-empty">Nenhuma demanda</div>}
              </div>
              {canEdit&&<button className="add-card" onClick={()=>create(stage)}><Plus size={15}/> Adicionar tarefa</button>}
            </section>)}
          </div>
        </>}
        {page==='dashboard'&&<IntelligenceDashboard tasks={tasks} onGoKanban={()=>setPage('kanban')}/>}
        {page==='map'&&<MapView tasks={tasks} onOpenTask={t=>{setSelected(t);setModalOpen(true);}}/>}
        {page==='meetings'&&<MeetingsPage profile={profile} alert={notify}/>}
      </main>
    </div>
    {modalOpen&&<TaskModal task={selected} initialStage={createStage} profile={profile}
      onClose={()=>setModalOpen(false)} onTaskSaved={onTaskSaved} alert={notify}/>}
    {notice&&<div className="toast" role="status"><span>{notice}</span><button aria-label="Fechar aviso" onClick={()=>setNotice('')}><X size={17}/></button></div>}
  </div>;
}
function SignIn({notify,notice}:{notify:(s:string)=>void;notice:string}){
  const [busy,setBusy]=useState(false);
  async function loginGoogle(){
    if(busy)return;
    setBusy(true);
    try{
      // Respeita a pasta do GitHub Pages e também funciona em localhost.
      const redirectTo=new URL(import.meta.env.BASE_URL,window.location.origin).toString();
      const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
      if(error)throw error;
      // Em um login bem-sucedido, o navegador é redirecionado ao Google.
    }catch(err){
      notify(friendlyError(err));
      setBusy(false);
    }
  }
  return <div className="login-screen"><div className="login-panel"><div className="brand-mark large">NA</div><h1>Núcleo de Articulação</h1><p>Demandas do Gabinete · São José do Rio Preto</p><button className="primary" style={{width:'100%',margin:'15px 0 22px'}} disabled={busy} type="button" onClick={()=>void loginGoogle()}><LogIn size={19}/>{busy?'Conectando ao Google...':'Entrar com Google'}</button><div className="login-info"><ShieldCheck size={19}/> Somente colaboradores autorizados podem acessar as demandas. A sessão fica salva neste navegador.</div>{notice&&<p className="hint">{notice}</p>}</div></div>;
}
