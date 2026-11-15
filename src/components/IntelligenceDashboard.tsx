import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays,
  CheckCircle2, Clock3, FilterX, Layers3, ListChecks, MapPin,
  RefreshCw, ShieldAlert, TrendingUp, Users, Zap,
} from 'lucide-react';
import {supabase} from '../lib/supabase';
import {PRIORITIES, STAGES} from '../lib/types';
import type {Priority, Stage, Task} from '../lib/types';
import '../styles/intelligence-dashboard.css';

type Period = '30'|'90'|'180'|'365'|'all';
type ActivityEntry = {task_id:string; event:string; details:string; created_at:string};
type MonthBucket = {key:string; label:string; received:number; completed:number};
const STAGE_COLORS = ['#93a5b8','#f6b74b','#4a8ae9','#9d77d6','#21ad8b'];
const PRIORITY_COLORS:Record<Priority,string>={Baixa:'#30b494',Média:'#4c88dd',Alta:'#f4a646',Urgente:'#e65b69'};
const DAY=86_400_000;
const nowDay=()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime();};
const dateValue=(s:string|null|undefined)=>s?new Date(s).getTime():NaN;
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const fmt=(n:number)=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(n);
const monthKey=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
const periodCutoff=(p:Period)=>p==='all'?0:nowDay()-(Number(p)-1)*DAY;
const isPending=(task:Task)=>task.stage!=='Concluído';
const getDayCount=(a:number,b:number)=>Math.max(0,Math.round((b-a)/DAY*10)/10);
const todayISO=()=>{const d=new Date();const pad=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
const currentDate = ()=>new Date();

function MiniMetric({name,value,detail,Icon,tone}: {name:string;value:string;detail:string;Icon:typeof Activity;tone?:string}){
  return <div className={`intel-metric ${tone?`intel-${tone}`:''}`}>
    <div className="intel-metric-name"><span>{name}</span><Icon size={18} aria-hidden="true"/></div>
    <strong>{value}</strong><small>{detail}</small>
  </div>;
}

function TrendBars({items}:{items:MonthBucket[]}){
  const max=Math.max(1,...items.flatMap(x=>[x.received,x.completed]));
  return <div className="intel-trend-chart" role="img" aria-label={`Recebidas e concluídas por mês: ${items.map(x=>`${x.label}: ${x.received} recebidas, ${x.completed} concluídas`).join('; ')}`}>
    <div className="intel-y-grid" aria-hidden="true">{[1,.75,.5,.25,0].map(p=><span key={p}>{Math.ceil(max*p)}</span>)}</div>
    <div className="intel-month-bars">{items.map(item=><div className="intel-month-col" key={item.key} title={`${item.label} — ${item.received} recebidas e ${item.completed} concluídas`}>
      <div className="intel-bar-group"><div className="intel-bar intel-in" style={{height:`${item.received/max*100}%`}}/><div className="intel-bar intel-out" style={{height:`${item.completed/max*100}%`}}/></div>
      <span>{item.label}</span>
    </div>)}</div>
  </div>;
}

export function IntelligenceDashboard({tasks,onGoKanban}:{tasks:Task[];onGoKanban:()=>void}){
  const [period,setPeriod]=useState<Period>('180');
  const [neighborhood,setNeighborhood]=useState('Todos');
  const [priority,setPriority]=useState<Priority|'Todas'>('Todas');
  const [stage,setStage]=useState<Stage|'Todas'>('Todas');
  const [activity,setActivity]=useState<ActivityEntry[]>([]);
  const [activityError,setActivityError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [lastUpdated,setLastUpdated]=useState<Date|null>(null);

  const fetchActivity=useCallback(async()=>{
    setRefreshing(true);setActivityError('');
    try{
      const {data,error}=await supabase.from('task_activity')
        .select('task_id,event,details,created_at')
        .eq('event','mudanca_etapa')
        .order('created_at',{ascending:false}).limit(5000);
      if(error)throw error;
      setActivity((data||[]) as ActivityEntry[]);
      setLastUpdated(new Date());
      if((data||[]).length===5000)setActivityError('Histórico limitado aos 5.000 eventos mais recentes. As métricas de resolução podem estar incompletas.');
    }catch(err){
      setActivity([]);
      setActivityError(`O histórico de etapas não pôde ser carregado: ${err instanceof Error?err.message:'erro desconhecido'}. O tempo médio e as conclusões por mês podem ficar indisponíveis.`);
    }finally{setRefreshing(false);}
  },[]);
  useEffect(()=>{void fetchActivity();},[fetchActivity]);

  const neighborhoods=useMemo(()=>Array.from(new Set(tasks.map(t=>t.neighborhood?.trim()).filter((v):v is string=>Boolean(v)))).sort((a,b)=>a.localeCompare(b,'pt-BR')), [tasks]);
  const filtered=useMemo(()=>{
    const since=periodCutoff(period);
    return tasks.filter(t=>{
      if(dateValue(t.created_at)<since)return false;
      if(neighborhood!=='Todos'&&norm(t.neighborhood?.trim()||'')!==norm(neighborhood))return false;
      if(priority!=='Todas'&&t.priority!==priority)return false;
      if(stage!=='Todas'&&t.stage!==stage)return false;
      return true;
    });
  },[tasks,period,neighborhood,priority,stage]);

  // Histórico oficial de transições da tabela task_activity. A última conclusão por demanda
  // evita contar novamente uma demanda reaberta e posteriormente concluída.
  const byTask=useMemo(()=>{
    const result=new Map<string,{lastStageAt:number;lastCompletionAt:number}>();
    for(const t of tasks)result.set(t.id,{lastStageAt:dateValue(t.created_at),lastCompletionAt:0});
    for(const event of activity){
      const item=result.get(event.task_id);if(!item)continue;
      const at=dateValue(event.created_at);if(!Number.isFinite(at))continue;
      if(at>item.lastStageAt)item.lastStageAt=at;
      if(event.details.includes('→ Concluído')&&at>item.lastCompletionAt)item.lastCompletionAt=at;
    }
    return result;
  },[activity,tasks]);

  const stats=useMemo(()=>{
    const total=filtered.length;
    const done=filtered.filter(t=>t.stage==='Concluído');
    const pending=filtered.filter(isPending);
    const late=pending.filter(t=>!!t.due_date&&t.due_date<todayISO());
    const day=nowDay();
    const stale=pending.filter(t=>day-dateValue(t.updated_at)>15*DAY);
    const stuck=pending.filter(t=>day-(byTask.get(t.id)?.lastStageAt||dateValue(t.created_at))>15*DAY);
    const urgent=pending.filter(t=>t.priority==='Alta'||t.priority==='Urgente');
    const durations=done.map(t=>{const completed=byTask.get(t.id)?.lastCompletionAt||0;return completed?getDayCount(dateValue(t.created_at),completed):null;}).filter((v):v is number=>v!==null&&Number.isFinite(v));
    const avg=durations.length?durations.reduce((a,b)=>a+b,0)/durations.length:null;
    const completedDays=(n:number)=>done.filter(t=>{const when=byTask.get(t.id)?.lastCompletionAt||0;return when>=day-(n-1)*DAY;}).length;
    return {total,done,pending,late,stale,stuck,urgent,avg,avgSample:durations.length,rate:total?done.length/total*100:0,c7:completedDays(7),c30:completedDays(30)};
  },[filtered,byTask]);

  const stages=useMemo(()=>STAGES.map((label,i)=>({label,value:filtered.filter(t=>t.stage===label).length,color:STAGE_COLORS[i]})),[filtered]);
  const priorities=useMemo(()=>PRIORITIES.map(label=>({label,value:filtered.filter(t=>t.priority===label).length,color:PRIORITY_COLORS[label]})),[filtered]);
  const neighborhoodRows=useMemo(()=>{
    const counts=new Map<string,{name:string,total:number,pending:number}>();
    for(const task of filtered){const name=task.neighborhood?.trim()||'Não informado';const key=norm(name);
      const old=counts.get(key)||{name,total:0,pending:0};old.total++;if(isPending(task))old.pending++;counts.set(key,old);
    }
    return Array.from(counts.values()).sort((a,b)=>b.pending-a.pending||b.total-a.total||a.name.localeCompare(b.name,'pt-BR')).slice(0,6);
  },[filtered]);

  const months=useMemo(()=>{
    const end=currentDate();
    const begin=period==='30'?2:period==='90'?4:period==='180'?6:period==='365'?12:12;
    const items:MonthBucket[]=[];
    for(let i=begin-1;i>=0;i--){const d=new Date(end.getFullYear(),end.getMonth()-i,1);items.push({key:monthKey(d),label:d.toLocaleDateString('pt-BR',{month:'short'}).replace('.',''),received:0,completed:0});}
    const m=new Map(items.map(x=>[x.key,x]));
    for(const task of filtered){
      const created=m.get(monthKey(new Date(task.created_at)));if(created)created.received++;
      if(task.stage==='Concluído'){
        const ended=byTask.get(task.id)?.lastCompletionAt||0;
        if(ended){const closed=m.get(monthKey(new Date(ended)));if(closed)closed.completed++;}
      }
    }
    return items;
  },[filtered,byTask,period]);
  const totalDonut=stages.reduce((n,item)=>n+item.value,0);
  let offset=0;
  const chartGradient=stages.map(s=>{
    const start=totalDonut?offset/totalDonut*100:0;offset+=s.value;
    const end=totalDonut?offset/totalDonut*100:0;
    return `${s.color} ${start}% ${end}%`;
  }).join(', ');
  const topPriority=Math.max(1,...priorities.map(x=>x.value));
  const isFiltered=period!=='180'||neighborhood!=='Todos'||priority!=='Todas'||stage!=='Todas';
  const reset=()=>{setPeriod('180');setNeighborhood('Todos');setPriority('Todas');setStage('Todas');};
  return <section className="intel-dashboard" aria-label="Painel de inteligência e desempenho das demandas">
    <div className="intel-header"><div><div className="intel-eyebrow"><TrendingUp size={15}/> ANÁLISE EXECUTIVA</div><h1>Inteligência e desempenho das demandas</h1><p>Indicadores da equipe · São José do Rio Preto · Atualização a partir do Supabase</p></div>
      <div className="intel-header-actions"><button type="button" className="intel-refresh" onClick={()=>void fetchActivity()} disabled={refreshing}><RefreshCw size={16} className={refreshing?'spin':''}/> Atualizar histórico</button><button type="button" className="intel-refresh" onClick={onGoKanban}><ListChecks size={16}/> Ver Kanban</button></div>
    </div>
    <div className="intel-filterbar" aria-label="Filtros dos indicadores">
      <label><span><CalendarDays size={14}/> Período de cadastro</span><select value={period} onChange={e=>setPeriod(e.target.value as Period)}><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="180">Últimos 6 meses</option><option value="365">Últimos 12 meses</option><option value="all">Todo o histórico</option></select></label>
      <label><span><MapPin size={14}/> Bairro</span><select value={neighborhood} onChange={e=>setNeighborhood(e.target.value)}><option value="Todos">Todos os bairros</option>{neighborhoods.map(x=><option key={x}>{x}</option>)}</select></label>
      <label><span><ShieldAlert size={14}/> Prioridade</span><select value={priority} onChange={e=>setPriority(e.target.value as Priority|'Todas')}><option value="Todas">Todas as prioridades</option>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></label>
      <label><span><Layers3 size={14}/> Situação</span><select value={stage} onChange={e=>setStage(e.target.value as Stage|'Todas')}><option value="Todas">Todas as etapas</option>{STAGES.map(x=><option key={x}>{x}</option>)}</select></label>
      <button type="button" className="intel-clear" onClick={reset} disabled={!isFiltered} title="Limpar todos os filtros"><FilterX size={17}/> Limpar</button>
    </div>
    <div className="intel-kpi-grid">
      <MiniMetric name="Demandas recebidas" value={fmt(stats.total)} detail="cadastradas no período" Icon={ListChecks}/>
      <MiniMetric name="Concluídas" value={fmt(stats.done.length)} detail="situação atual" Icon={CheckCircle2} tone="green"/>
      <MiniMetric name="Pendentes" value={fmt(stats.pending.length)} detail="ainda não concluídas" Icon={Activity} tone="blue"/>
      <MiniMetric name="Prazos vencidos" value={fmt(stats.late.length)} detail="pendentes com prazo vencido" Icon={AlertCircle} tone="red"/>
      <MiniMetric name="Taxa de conclusão" value={`${stats.rate.toFixed(1).replace('.',',')}%`} detail="concluídas / cadastradas" Icon={TrendingUp} tone="teal"/>
      <MiniMetric name="Tempo médio de resolução" value={stats.avg===null?'—':`${stats.avg.toFixed(1).replace('.',',')} dias`} detail={stats.avg===null?'sem histórico suficiente':`base: ${stats.avgSample} conclusão(ões) registrada(s)`} Icon={Clock3}/>
    </div>
    {activityError&&<div className="intel-warning"><AlertCircle size={17}/>{activityError}</div>}
    {tasks.length>=1000&&<div className="intel-warning"><AlertCircle size={17}/> O quadro atual carrega no máximo 1.000 tarefas. Os indicadores podem não representar todo o histórico; para volumes maiores, implemente paginação.</div>}
    <div className="intel-analytics-grid">
      <section className="intel-panel intel-trend-panel"><div className="intel-panel-heading"><div><div className="intel-panel-icon"><BarChart3 size={17}/></div><div><h2>Evolução mensal das demandas</h2><p>Entradas e conclusões registradas mês a mês</p></div></div><div className="intel-chart-legend"><span><i className="received"/> Recebidas</span><span><i className="completed"/> Concluídas</span></div></div>
        <TrendBars items={months}/>
        <p className="intel-panel-footnote">As conclusões mensais consideram mudanças para “Concluído” registradas no histórico. O gráfico respeita os filtros selecionados.</p>
      </section>
      <section className="intel-panel intel-ranking-panel"><div className="intel-panel-heading"><div><div className="intel-panel-icon"><MapPin size={17}/></div><div><h2>Ranking de bairros</h2><p>Mais demandas pendentes</p></div></div></div>
        {neighborhoodRows.length?<div className="intel-neighborhoods">{neighborhoodRows.map((x,i)=><button key={x.name} type="button" className="intel-ranking-row" title={`Filtrar por ${x.name}`} onClick={()=>{if(x.name!=='Não informado')setNeighborhood(x.name);}} disabled={x.name==='Não informado'}>
          <span className={`intel-rank-number ${i===0?'first':''}`}>{i+1}</span><span className="intel-rank-name">{x.name}</span><strong>{x.pending}</strong></button>)}</div>:<p className="intel-empty">Nenhuma demanda no filtro selecionado.</p>}
        <p className="intel-panel-footnote">Clique em um bairro para filtrar. Números refletem demandas pendentes, não visitas realizadas.</p>
      </section>
      <section className="intel-panel intel-status-panel"><div className="intel-panel-heading"><div><div className="intel-panel-icon"><Layers3 size={17}/></div><div><h2>Distribuição por etapa</h2><p>Situação atual no Kanban</p></div></div></div>
        <div className="intel-donut-zone"><div className="intel-donut" style={{background:totalDonut?`conic-gradient(${chartGradient})`:'#e8edf5'}}><div><strong>{fmt(totalDonut)}</strong><small>tarefas</small></div></div></div>
        <div className="intel-stage-list">{stages.map(s=><div key={s.label}><span><i style={{background:s.color}}/>{s.label}</span><strong>{s.value}</strong></div>)}</div>
      </section>
      <section className="intel-panel intel-priority-panel"><div className="intel-panel-heading"><div><div className="intel-panel-icon"><ShieldAlert size={17}/></div><div><h2>Demandas por prioridade</h2><p>Distribuição das tarefas</p></div></div></div>
        <div className="intel-priority-grid">{priorities.map(item=><div key={item.label} className="intel-priority-item"><span className="intel-priority-number">{item.value}</span><div className="intel-priority-track"><div style={{height:`${item.value/topPriority*100}%`,background:item.color}}/></div><span>{item.label}</span></div>)}</div>
      </section>
      <section className="intel-panel intel-alerts-panel"><div className="intel-panel-heading"><div><div className="intel-panel-icon"><Zap size={17}/></div><div><h2>Atenção da gestão</h2><p>Pontos que merecem acompanhamento</p></div></div></div>
        <div className="intel-alert-grid">
          <div className="intel-alert-item"><span className="intel-alert-mark red"><Clock3 size={19}/></span><div><strong>{fmt(stats.stale.length)}</strong><span>Demandas sem atualização há mais de 15 dias</span></div><ArrowUpRight size={16}/></div>
          <div className="intel-alert-item"><span className="intel-alert-mark orange"><ShieldAlert size={19}/></span><div><strong>{fmt(stats.urgent.length)}</strong><span>Pendentes de prioridade alta ou urgente</span></div><ArrowUpRight size={16}/></div>
          <div className="intel-alert-item"><span className="intel-alert-mark purple"><Layers3 size={19}/></span><div><strong>{fmt(stats.stuck.length)}</strong><span>Demandas há mais de 15 dias na mesma etapa</span></div><ArrowUpRight size={16}/></div>
          <div className="intel-alert-item"><span className="intel-alert-mark green"><CheckCircle2 size={19}/></span><div><strong>{fmt(stats.c7)} <small>/ {fmt(stats.c30)}</small></strong><span>Concluídas nos últimos 7 / 30 dias</span></div><ArrowDownRight size={16}/></div>
        </div>
      </section>
    </div>
    <footer className="intel-footer"><span><Users size={14}/> Indicadores calculados somente a partir das demandas e do histórico acessíveis no Supabase.</span><span>{lastUpdated?`Histórico consultado às ${lastUpdated.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'Consultando histórico...'}</span></footer>
  </section>;
}
