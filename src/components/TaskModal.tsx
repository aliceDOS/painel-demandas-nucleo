import { useCallback, useEffect, useState } from 'react';
import { Check, CheckCheck, ClipboardCheck, Clock3, MessageCircle, Plus, Trash2, X, MapPin, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { blankTask, friendlyError, PRIORITIES, STAGES } from '../lib/types';
import type { ChecklistItem, Profile, Stage, Task, TaskAttachment, TaskComment, TaskInput, TaskPerson } from '../lib/types';
import { Attachments } from './Attachments';
import { locateTaskAddress } from '../lib/geocode';

type Activity = { id: string; event: string; details: string; created_at: string; };
interface Props {
  task: Task | null;
  initialStage: Stage;
  profile: Profile;
  onClose: () => void;
  onTaskSaved: (task: Task) => void;
  alert: (message: string) => void;
}
const dateTime=(date:string)=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(date));
export function TaskModal({task,initialStage,profile,onClose,onTaskSaved,alert}:Props){
  const canEdit=profile.role!=='viewer';
  const [form,setForm]=useState<TaskInput>(task ? extract(task) : blankTask(initialStage));
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [locating,setLocating]=useState(false);
  const [checklist,setChecklist]=useState<ChecklistItem[]>([]);
  const [comments,setComments]=useState<TaskComment[]>([]);
  const [people,setPeople]=useState<TaskPerson[]>([]);
  const [attachments,setAttachments]=useState<TaskAttachment[]>([]);
  const [activity,setActivity]=useState<Activity[]>([]);
  const [checkTitle,setCheckTitle]=useState('');
  const [comment,setComment]=useState('');
  const [person,setPerson]=useState('');
  const update=(patch:Partial<TaskInput>)=>setForm(old=>({...old,...patch}));
  const loadAttachments=useCallback(async()=>{
    if(!task)return;
    const {data,error}=await supabase.from('task_attachments')
      .select('id,task_id,file_name,mime_type,byte_size,created_at,uploaded_by')
      .eq('task_id',task.id).order('created_at',{ascending:false});
    if(error)throw error;
    setAttachments((data||[]) as TaskAttachment[]);
  },[task?.id]);
  const loadDetails=useCallback(async()=>{
    if(!task)return;
    const [a,b,c,d]=await Promise.all([
      supabase.from('checklist_items').select('*').eq('task_id',task.id).order('position'),
      supabase.from('task_comments').select('id,task_id,body,author_id,created_at,profiles(display_name)').eq('task_id',task.id).order('created_at',{ascending:false}),
      supabase.from('task_people').select('*').eq('task_id',task.id).order('created_at'),
      supabase.from('task_activity').select('id,event,details,created_at').eq('task_id',task.id).order('created_at',{ascending:false}).limit(30),
    ]);
    for(const r of [a,b,c,d])if(r.error)throw r.error;
    setChecklist((a.data||[]) as ChecklistItem[]);
    setComments((b.data||[]) as unknown as TaskComment[]);
    setPeople((c.data||[]) as TaskPerson[]);
    setActivity((d.data||[]) as Activity[]);
    await loadAttachments();
  },[task?.id,loadAttachments]);
  useEffect(()=>{
    setForm(task?extract(task):blankTask(initialStage));
    setChecklist([]);setComments([]);setPeople([]);setAttachments([]);setActivity([]);
    if(task){setLoading(true);loadDetails().catch(e=>alert(friendlyError(e))).finally(()=>setLoading(false));}
  },[task?.id,initialStage,loadDetails]);
  useEffect(()=>{
    const keydown=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',keydown);
    return()=>document.removeEventListener('keydown',keydown);
  },[onClose]);
  async function saveTask(e:React.FormEvent){
    e.preventDefault(); if(!canEdit)return;
    if(form.title.trim().length<2){alert('Informe um título com pelo menos 2 caracteres.');return;}
    const cep = form.postal_code.replace(/\D/g, '');
    if(cep && cep.length!==8){alert('O CEP precisa ter exatamente 8 números.');return;}
    setBusy(true);
    try{
      const payload={...form,title:form.title.trim(),description:form.description.trim(),due_date:form.due_date||null};
      const hasPlace = Boolean(cep || form.street.trim() || form.neighborhood.trim());
      const addressChanged = !task || (['street','street_number','neighborhood','city','postal_code'] as const)
        .some(field => form[field] !== task[field]);
      const missingCoordinates = payload.latitude===null || payload.longitude===null;
      let locationNotice = '';
      // CEP e endereço passam a ser localizados automaticamente ao salvar.
      // As coordenadas existentes só são recalculadas se o endereço foi alterado.
      if(hasPlace && (addressChanged || missingCoordinates)){
        try{
          const located = await locateTaskAddress(form);
          payload.latitude = located.latitude;
          payload.longitude = located.longitude;
          payload.street ||= located.address.street;
          payload.neighborhood ||= located.address.neighborhood;
          payload.city ||= located.address.city;
          locationNotice = located.approximate ? ' Localização aproximada pelo CEP/bairro; informe também o número para melhorar a precisão.' : '';
        }catch(error){
          payload.latitude = null; payload.longitude = null;
          locationNotice = ` A tarefa foi salva, mas não foi localizada no mapa: ${friendlyError(error)}`;
        }
      }
      if(!hasPlace){ payload.latitude=null; payload.longitude=null; }
      const request=task
        ?supabase.from('tasks').update(payload).eq('id',task.id).select('*').single()
        :supabase.from('tasks').insert({...payload,created_by:profile.id}).select('*').single();
      const {data,error}=await request;
      if(error)throw error;
      const saved=data as Task;
      onTaskSaved(saved);setForm(extract(saved));
      alert((task?'Tarefa atualizada.':'Tarefa criada. Agora você pode adicionar o checklist e os anexos.')+locationNotice);
    }catch(err){alert(friendlyError(err));}finally{setBusy(false);}
  }
  async function locate(){
    if(!form.street.trim()&&!form.neighborhood.trim()&&!form.postal_code.trim()){
      alert('Informe um CEP, bairro ou rua.');return;
    }
    setLocating(true);
    try{
      const r=await locateTaskAddress(form);
      update({latitude:r.latitude,longitude:r.longitude,street:form.street||r.address.street,
        neighborhood:form.neighborhood||r.address.neighborhood,city:form.city||r.address.city});
      alert(`Localização ${r.approximate?'aproximada':'encontrada'}: ${r.label}. Clique em Salvar tarefa para registrar.`);
    }catch(err){alert(friendlyError(err));}finally{setLocating(false);}
  }
  async function addChecklist(e:React.FormEvent){
    e.preventDefault();if(!task||!checkTitle.trim()||!canEdit)return;
    const {error}=await supabase.from('checklist_items').insert({task_id:task.id,title:checkTitle.trim(),position:checklist.length});
    if(error){alert(error.message);return;}setCheckTitle('');await refreshChecklist();
  }
  async function refreshChecklist(){
    if(!task)return;
    const {data,error}=await supabase.from('checklist_items').select('*').eq('task_id',task.id).order('position');
    if(error)throw error;
    setChecklist((data||[])as ChecklistItem[]);
  }
  async function toggleCheck(item:ChecklistItem){
    if(!task||!canEdit)return;
    const {error}=await supabase.from('checklist_items').update({is_done:!item.is_done}).eq('id',item.id);
    if(error){alert(error.message);return;}
    try{
      await refreshChecklist();
      const {data, error:taskError}=await supabase.from('tasks').select('*').eq('id',task.id).single();
      if(taskError)throw taskError;
      const updated=data as Task;
      if(updated.stage!==task.stage)alert(`Checklist concluído! A demanda avançou para "${updated.stage}".`);
      onTaskSaved(updated);update({stage:updated.stage});
      const {data:history}=await supabase.from('task_activity').select('id,event,details,created_at').eq('task_id',task.id).order('created_at',{ascending:false}).limit(30);
      setActivity((history||[]) as Activity[]);
    }catch(err){alert(friendlyError(err));}
  }
  async function deleteCheck(item:ChecklistItem){
    if(!canEdit||!window.confirm(`Remover o item "${item.title}"?`))return;
    const {error}=await supabase.from('checklist_items').delete().eq('id',item.id);
    if(error)alert(error.message);else await refreshChecklist();
  }
  async function addComment(e:React.FormEvent){
    e.preventDefault();if(!task||!canEdit||!comment.trim())return;
    const {error}=await supabase.from('task_comments').insert({task_id:task.id,body:comment.trim(),author_id:profile.id});
    if(error){alert(error.message);return;}setComment('');
    const {data}=await supabase.from('task_comments').select('id,task_id,body,author_id,created_at,profiles(display_name)').eq('task_id',task.id).order('created_at',{ascending:false});
    setComments((data||[]) as unknown as TaskComment[]);
  }
  async function addPerson(e:React.FormEvent){
    e.preventDefault();if(!task||!canEdit||person.trim().length<2)return;
    const {error}=await supabase.from('task_people').insert({task_id:task.id,name:person.trim()});
    if(error){alert(error.message);return;}setPerson('');
    const {data}=await supabase.from('task_people').select('*').eq('task_id',task.id).order('created_at');
    setPeople((data||[]) as TaskPerson[]);
  }
  async function removePerson(id:string){
    if(!canEdit||!window.confirm('Remover o vínculo desta pessoa com a demanda?'))return;
    const {error}=await supabase.from('task_people').delete().eq('id',id);
    if(error)alert(error.message);else setPeople(old=>old.filter(p=>p.id!==id));
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={task?`Demanda #${task.number}`:'Nova demanda'}>
      <div className="modal-head">
        <div><div className="eyebrow">Núcleo de Articulação</div><h2>{task?`Demanda #${task.number}`:'Nova demanda'}</h2></div>
        <button className="icon-button" onClick={onClose} title="Fechar"><X size={22}/></button>
      </div>
      <div className="modal-columns">
        <div className="modal-primary">
          <form id="task-form" onSubmit={saveTask}>
            <h3>Informações da demanda</h3>
            <div className="field-grid">
              <label className="span-2">Título<input required minLength={2} maxLength={160} disabled={!canEdit} value={form.title} onChange={e=>update({title:e.target.value})}/></label>
              <label>Status<select disabled={!canEdit} value={form.stage} onChange={e=>update({stage:e.target.value as Stage})}>{STAGES.map(s=><option key={s}>{s}</option>)}</select></label>
              <label>Prioridade<select disabled={!canEdit} value={form.priority} onChange={e=>update({priority:e.target.value as Task['priority']})}>{PRIORITIES.map(p=><option key={p}>{p}</option>)}</select></label>
              <label>Prazo<input type="date" disabled={!canEdit} value={form.due_date||''} onChange={e=>update({due_date:e.target.value||null})}/></label>
              <label>Responsável<input disabled={!canEdit} maxLength={160} value={form.responsible} onChange={e=>update({responsible:e.target.value})}/></label>
              <label className="span-2">Organização / secretaria<input disabled={!canEdit} maxLength={160} value={form.organization} onChange={e=>update({organization:e.target.value})}/></label>
              <label className="span-2">Descrição<textarea className="description" disabled={!canEdit} maxLength={15000} rows={6} value={form.description} onChange={e=>update({description:e.target.value})} placeholder="Descreva a demanda e seus próximos passos..."/></label>
            </div>
            <h3 className="subheading"><MapPin size={18}/> Endereço e bairro</h3>
            <div className="field-grid">
              <label>Bairro<input disabled={!canEdit} maxLength={150} value={form.neighborhood} onChange={e=>update({neighborhood:e.target.value,latitude:null,longitude:null})}/></label>
              <label>Cidade<input disabled={!canEdit} maxLength={150} value={form.city} onChange={e=>update({city:e.target.value,latitude:null,longitude:null})}/></label>
              <label className="span-2">Rua / avenida<input disabled={!canEdit} maxLength={200} value={form.street} onChange={e=>update({street:e.target.value,latitude:null,longitude:null})}/></label>
              <label>Número<input disabled={!canEdit} maxLength={30} value={form.street_number} onChange={e=>update({street_number:e.target.value,latitude:null,longitude:null})}/></label>
              <label>CEP<input disabled={!canEdit} maxLength={9} value={form.postal_code} onChange={e=>update({postal_code:e.target.value,latitude:null,longitude:null})}/></label>
            </div>
            <div className="location-actions"><button type="button" className="secondary" disabled={!canEdit||locating} onClick={locate}><MapPin size={16}/>{locating?'Localizando...':'Localizar no mapa'}</button><small className="muted">{form.latitude!==null&&form.longitude!==null?'Coordenadas obtidas; salve para registrar.':'O CEP/endereço será localizado automaticamente ao salvar. Você também pode localizar antes.'}</small></div>
          </form>
          {task&&<>
            <section className="detail-section">
              <div className="section-heading"><h3><ClipboardCheck size={18}/> Checklist</h3>
                <strong>{checklist.filter(c=>c.is_done).length}/{checklist.length} concluídos</strong></div>
              <div className="progress-track large"><div style={{width:`${checklist.length?checklist.filter(c=>c.is_done).length/checklist.length*100:0}%`}}/></div>
              <p className="muted short-help">Ao concluir o último item pendente, esta demanda avança automaticamente UMA etapa. A automação funciona mesmo sem manter esta página aberta.</p>
              {checklist.map(item=><div className="check-row" key={item.id}>
                <label><input type="checkbox" disabled={!canEdit} checked={item.is_done} onChange={()=>toggleCheck(item)}/><span className={item.is_done?'done':''}>{item.title}</span></label>
                {canEdit&&<button className="icon-button" title="Remover item" onClick={()=>deleteCheck(item)}><Trash2 size={15}/></button>}
              </div>)}
              {!checklist.length&&<p className="muted">Nenhum item de checklist cadastrado.</p>}
              {canEdit&&<form className="inline-form" onSubmit={addChecklist}><input maxLength={240} placeholder="Adicionar item do checklist" value={checkTitle} onChange={e=>setCheckTitle(e.target.value)} required minLength={2}/><button className="secondary" type="submit"><Plus size={16}/> Adicionar</button></form>}
              {!!checklist.length&&checklist.every(i=>i.is_done)&&<p className="success"><CheckCheck size={16}/> Todos os itens concluídos.</p>}
            </section>
            <Attachments taskId={task.id} attachments={attachments} canEdit={canEdit} onChanged={loadAttachments} alert={alert}/>
            <section className="detail-section">
              <h3>Pessoas vinculadas</h3>
              <p className="muted short-help">Somente nomes necessários ao atendimento. Não registre opinião ou posição política.</p>
              <div className="person-list">{people.map(p=><div className="person-row" key={p.id}><span>{p.name}</span>{canEdit&&<button title="Remover vínculo" className="icon-button" onClick={()=>removePerson(p.id)}><Trash2 size={15}/></button>}</div>)}</div>
              {canEdit&&<form className="inline-form" onSubmit={addPerson}><input placeholder="Nome da pessoa" maxLength={150} minLength={2} required value={person} onChange={e=>setPerson(e.target.value)}/><button type="submit" className="secondary"><Plus size={16}/> Vincular</button></form>}
            </section>
          </>}
        </div>
        <aside className="modal-aside">
          <h3><MessageCircle size={18}/> Comentários e histórico</h3>
          {!task&&<p className="muted">Salve a demanda para habilitar comentários, checklist e anexos.</p>}
          {loading&&<p className="muted">Carregando registros…</p>}
          {task&&<>
            {canEdit&&<form onSubmit={addComment} className="comment-form"><textarea rows={4} maxLength={3000} placeholder="Escreva uma atualização para a equipe..." value={comment} onChange={e=>setComment(e.target.value)}/><button className="primary" type="submit"><Plus size={16}/> Adicionar comentário</button></form>}
            {comments.map(c=><article className="comment" key={c.id}><div className="comment-meta"><b>{c.profiles?.display_name || 'Equipe'}</b><span>{dateTime(c.created_at)}</span></div><p>{c.body}</p></article>)}
            {!comments.length&&<p className="muted">Sem comentários registrados.</p>}
            <h4 className="history-head"><Clock3 size={15}/> Movimentações</h4>
            {activity.map(x=><div className="history-event" key={x.id}><b>{x.details}</b><small>{dateTime(x.created_at)}</small></div>)}
            {!activity.length&&<p className="muted">Nenhuma movimentação registrada.</p>}
          </>}
        </aside>
      </div>
      <div className="modal-foot"><div className="muted"><Check size={14}/> {task?'Alterações sincronizadas pelo Supabase':'Nova demanda'}</div>
        <div><button type="button" className="secondary" onClick={onClose}>Fechar</button>
        {canEdit&&<button type="submit" form="task-form" className="primary" disabled={busy}><Save size={16}/>{busy?'Salvando...':'Salvar tarefa'}</button>}</div>
      </div>
    </div>
  </div>;
}
function extract(t:Task):TaskInput{
  return {title:t.title,description:t.description,stage:t.stage,priority:t.priority,due_date:t.due_date,
    responsible:t.responsible,organization:t.organization,neighborhood:t.neighborhood,city:t.city,
    street:t.street,street_number:t.street_number,postal_code:t.postal_code,
    latitude:t.latitude,longitude:t.longitude};
}
