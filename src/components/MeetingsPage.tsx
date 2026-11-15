import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import axios from 'axios';
import { CalendarDays, Check, Clock3, FilePlus2, FileText, Pencil, RefreshCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';
import '../styles/meetings.css';
import '../styles/meetings-compact.css';

interface Meeting {
  id: string;
  title: string;
  meeting_date: string;
  meeting_time: string | null;
  created_by: string;
}
interface MeetingAttachment {
  id: string;
  meeting_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
}
type MeetingForm = Pick<Meeting, 'title' | 'meeting_date' | 'meeting_time'>;
const blankForm = (): MeetingForm => ({ title: '', meeting_date: '', meeting_time: '' });
const MAX_SIZE = 15 * 1024 * 1024;
const MAX_FILES = 30;
const formatDate = (date: string) => date ? date.slice(0, 10).split('-').reverse().join('/') : '—';
const sizeLabel = (n: number) => n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meeting-files`;

async function sessionHeaders() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('Sessão expirada. Entre no Kanban novamente.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  };
}
function readableError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data;
    if (responseData && typeof responseData === 'object' && 'error' in responseData) {
      const reason = (responseData as { error?: unknown }).error;
      if (typeof reason === 'string') return reason;
    }
    if (error.response) return `Erro HTTP ${error.response.status}: ${error.message}`;
    return `${error.message}. Confira a origem autorizada (ALLOWED_ORIGINS) e a função meeting-files.`;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const msg = error.message;
    if (/meetings|meeting_attachments/i.test(msg) && /does not exist|schema cache|not found/i.test(msg)) {
      return 'As tabelas de reuniões não foram encontradas. Confira se o SQL 002_pautas_reunioes.sql foi executado no Supabase V2.';
    }
    return msg;
  }
  return 'Erro inesperado. Confira o Console do navegador e os registros do Supabase.';
}
function checkFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) return `Limite de ${MAX_FILES} PDFs por reunião.`;
  for (const f of files) {
    if (f.size < 1 || f.size > MAX_SIZE || !(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) {
      return `Arquivo inválido: ${f.name}. Envie PDFs de até 15 MB cada.`;
    }
  }
  return null;
}

export function MeetingsPage({ profile, alert }: { profile: Profile; alert: (message: string) => void }) {
  const editable = profile.role === 'admin' || profile.role === 'editor';
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attachments, setAttachments] = useState<MeetingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<MeetingForm>(blankForm());
  const [pendingPdfs, setPendingPdfs] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);
  const closeViewer = () => setViewer(old => { if (old) URL.revokeObjectURL(old.url); return null; });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, a] = await Promise.all([
        supabase.from('meetings').select('id,title,meeting_date,meeting_time,created_by').order('meeting_date', { ascending: false }).limit(500),
        supabase.from('meeting_attachments').select('id,meeting_id,file_name,mime_type,byte_size,created_at').order('created_at', { ascending: false }).limit(1000),
      ]);
      if (m.error) throw m.error;
      if (a.error) throw a.error;
      setMeetings((m.data || []) as Meeting[]);
      setAttachments((a.data || []) as MeetingAttachment[]);
      setLoadError('');
    } catch (e) {
      const reason = readableError(e);
      setLoadError(reason);
      alert(`Pautas e reuniões: ${reason}`);
    } finally { setLoading(false); }
  }, [alert]);
  useEffect(() => {
    void load();
    const channel = supabase.channel('nucleo-meetings-' + profile.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_attachments' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, profile.id]);
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url); }, [viewer]);

  const visible = useMemo(() => {
    const q = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return meetings.filter(m => !q || [m.title, m.meeting_date].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q));
  }, [meetings, query]);
  const filesOf = (id: string) => attachments.filter(a => a.meeting_id === id);
  const resetForm = () => { setForm(blankForm()); setPendingPdfs([]); setEditingId(null); };
  function editMeeting(meeting: Meeting) {
    setEditingId(meeting.id);
    setForm({ title: meeting.title, meeting_date: meeting.meeting_date, meeting_time: meeting.meeting_time || '' });
    setPendingPdfs([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function selectPdfs(evt: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(evt.target.files || []);
    evt.target.value = '';
    if (!files.length) return;
    const next = [...pendingPdfs, ...files];
    const err = checkFiles(next);
    if (err) { alert(err); return; }
    if (editingId && filesOf(editingId).length + next.length > MAX_FILES) {
      alert(`Esta reunião pode ter no máximo ${MAX_FILES} PDFs.`); return;
    }
    setPendingPdfs(next);
  }
  async function uploadFiles(meetingId: string, selected: File[]) {
    const failures: string[] = [];
    let succeeded = 0;
    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      const marker = `${meetingId}-${i}-${file.name}`;
      try {
        const headers = await sessionHeaders();
        setProgress(old => ({ ...old, [marker]: 0 }));
        await axios.post(`${functionUrl}?action=upload`, file, {
          headers: { ...headers, 'Content-Type': 'application/pdf', 'x-meeting-id': meetingId, 'x-file-name': encodeURIComponent(file.name) },
          onUploadProgress: evt => {
            if (evt.total) setProgress(old => ({ ...old, [marker]: Math.round(evt.loaded / evt.total * 95) }));
          },
          timeout: 120000,
        });
        succeeded++;
      } catch (e) { failures.push(`${file.name}: ${readableError(e)}`); }
      finally {
        setProgress(old => { const next = { ...old }; delete next[marker]; return next; });
      }
    }
    return { succeeded, failures };
  }
  async function saveMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || busy) return;
    if (form.title.trim().length < 2 || !form.meeting_date) { alert('Preencha o título e a data.'); return; }
    const validation = checkFiles(pendingPdfs);
    if (validation) { alert(validation); return; }
    setBusy(true);
    let meetingId: string | null = null;
    try {
      const data = { title: form.title.trim(), meeting_date: form.meeting_date, meeting_time: form.meeting_time || null };
      if (editingId) {
        const { error } = await supabase.from('meetings').update(data).eq('id', editingId);
        if (error) throw error;
        meetingId = editingId;
      } else {
        // Os outros campos da tabela (department, location, agenda e notes)
        // têm default vazio no SQL anterior e não são alterados aqui.
        const { data: created, error } = await supabase.from('meetings')
          .insert({ ...data, created_by: profile.id }).select('id').single();
        if (error) throw error;
        if (!created?.id) throw new Error('A reunião foi cadastrada, mas o Supabase não retornou o ID.');
        meetingId = created.id;
      }
      let uploadMessage = '';
      if (pendingPdfs.length) {
        const result = await uploadFiles(meetingId, pendingPdfs);
        if (result.failures.length) uploadMessage = ` Reunião salva, mas ${result.failures.length} PDF(s) falharam: ${result.failures.join('; ')}`;
        else uploadMessage = ` ${result.succeeded} PDF(s) enviado(s).`;
      }
      resetForm();
      alert((editingId ? 'Reunião atualizada.' : 'Reunião cadastrada.') + uploadMessage);
      await load();
    } catch (e) {
      // Se o registro foi criado, evita sugerir ao usuário que salve novamente
      // e duplique uma reunião por causa de uma falha posterior.
      const reason = readableError(e);
      if (meetingId) { resetForm(); await load(); alert(`Reunião cadastrada, mas ocorreu um problema depois: ${reason}`); }
      else alert(`Não foi possível salvar a reunião: ${reason}`);
    } finally { setBusy(false); }
  }
  async function deleteMeeting(meeting: Meeting) {
    if (profile.role !== 'admin') return;
    if (filesOf(meeting.id).length) { alert('Remova os PDFs antes de excluir a reunião.'); return; }
    if (!window.confirm(`Excluir a reunião “${meeting.title}”?`)) return;
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id);
    if (error) alert(readableError(error));
    else { alert('Reunião excluída.'); await load(); }
  }
  async function addPdfsToExisting(meetingId: string, evt: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(evt.target.files || []);
    evt.target.value = '';
    if (!selected.length || !editable) return;
    const error = checkFiles(selected);
    if (error) { alert(error); return; }
    if (filesOf(meetingId).length + selected.length > MAX_FILES) { alert(`Limite de ${MAX_FILES} PDFs por reunião.`); return; }
    setBusy(true);
    try {
      const result = await uploadFiles(meetingId, selected);
      if (result.succeeded) alert(`${result.succeeded} PDF(s) enviado(s).`);
      if (result.failures.length) alert(`Falha em ${result.failures.length} PDF(s): ${result.failures.join('; ')}`);
      await load();
    } finally { setBusy(false); }
  }
  async function openPdf(file: MeetingAttachment) {
    try {
      const headers = await sessionHeaders();
      const response = await axios.get<Blob>(`${functionUrl}?action=download&id=${encodeURIComponent(file.id)}`, { headers, responseType: 'blob', timeout: 120000 });
      const url = URL.createObjectURL(response.data);
      setViewer(old => { if (old) URL.revokeObjectURL(old.url); return { url, name: file.file_name }; });
    } catch (e) { alert(`Não foi possível visualizar o PDF: ${readableError(e)}`); }
  }
  async function deletePdf(file: MeetingAttachment) {
    if (!editable || !window.confirm(`Remover “${file.file_name}” da reunião e do Google Drive?`)) return;
    try {
      const headers = await sessionHeaders();
      await axios.delete(`${functionUrl}?action=delete&id=${encodeURIComponent(file.id)}`, { headers, timeout: 120000 });
      alert('PDF removido.'); await load();
    } catch (e) { alert(`Falha ao excluir PDF: ${readableError(e)}`); }
  }
  return <section className="meet-page meet-page-compact" aria-label="Pautas e reuniões">
    <div className="pane-heading"><div><div className="eyebrow">NÚCLEO DE ARTICULAÇÃO</div><h1>Pautas e reuniões</h1><p>Cadastre o assunto, a data e o horário. Anexe os PDFs da reunião.</p></div>
      <button type="button" className="secondary" onClick={() => void load()} disabled={loading}><RefreshCcw size={16}/> Atualizar</button>
    </div>
    <div className="meet-layout">
      <div className="meet-form-panel">
        <h2>{editingId ? 'Editar reunião' : 'Nova reunião'}</h2>
        {editable ? <form className="meet-form" onSubmit={e => void saveMeeting(e)}>
          <label>Título da reunião *<input required maxLength={180} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ex.: Reunião de planejamento das próximas visitas"/></label>
          <div className="meet-two">
            <label>Data *<input type="date" required value={form.meeting_date} onChange={e => setForm(f => ({ ...f, meeting_date: e.target.value }))}/></label>
            <label>Horário<input type="time" value={form.meeting_time || ''} onChange={e => setForm(f => ({ ...f, meeting_time: e.target.value }))}/></label>
          </div>
          <div className="meet-initial-upload">
            <label className="meet-pdf-picker"><FilePlus2 size={20}/> <span>Adicionar PDFs da reunião</span>
              <small>Selecione vários PDFs de uma vez · até 15 MB por arquivo</small>
              <input type="file" accept=".pdf,application/pdf" multiple onChange={selectPdfs} disabled={busy}/>
            </label>
            {pendingPdfs.length > 0 && <div className="meet-selected-pdfs">
              {pendingPdfs.map((f, i) => <div key={`${f.name}-${i}`} className="meet-selected-pdf"><FileText size={16}/><span>{f.name} ({sizeLabel(f.size)})</span><button type="button" title="Retirar da seleção" onClick={() => setPendingPdfs(old => old.filter((_, j) => j !== i))} disabled={busy}><X size={15}/></button></div>)}
            </div>}
          </div>
          <div className="meet-form-actions"><button type="submit" className="primary" disabled={busy}><Check size={16}/>{busy ? 'Salvando...' : pendingPdfs.length ? 'Cadastrar reunião e enviar PDFs' : editingId ? 'Salvar alterações' : 'Cadastrar reunião'}</button>
            {editingId && <button type="button" className="secondary" onClick={resetForm} disabled={busy}>Cancelar edição</button>}
          </div>
          {Object.entries(progress).map(([key, value]) => <div className="meet-progress" key={key}><Upload size={14}/><div><div style={{ width: `${value}%` }}/></div><span>{value}%</span></div>)}
          <p className="meet-help">Os PDFs serão salvos no Google Drive, associados a esta reunião. O envio é permitido apenas a usuários autorizados.</p>
        </form> : <p className="meet-help">Você pode consultar reuniões e documentos. Para cadastrar, precisa de acesso de editor ou administrador.</p>}
      </div>
      <div className="meet-list-panel">
        <div className="meet-list-head"><h2>Reuniões cadastradas <span className="meet-count">{visible.length}</span></h2><div className="meet-search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar pelo título da reunião" aria-label="Buscar reuniões"/></div></div>
        {loadError && <div className="meet-load-error" role="alert">{loadError}</div>}
        {loading ? <p className="meet-help">Carregando reuniões...</p> : visible.length === 0 ? <div className="meet-empty"><CalendarDays size={30}/><strong>Nenhuma reunião encontrada</strong><p>{loadError ? 'Verifique a mensagem de erro acima.' : 'Cadastre a primeira reunião usando o formulário.'}</p></div> : <div className="meet-cards">
          {visible.map(meeting => {
            const files = filesOf(meeting.id);
            const expanded = openId === meeting.id;
            return <article className="meet-card" key={meeting.id}>
              <h3>{meeting.title}</h3>
              <div className="meet-meta"><span><CalendarDays size={14}/>{formatDate(meeting.meeting_date)}</span>{meeting.meeting_time && <span><Clock3 size={14}/>{meeting.meeting_time.slice(0, 5)}</span>}<span><FileText size={14}/>{files.length} PDF(s)</span></div>
              <div className="meet-card-actions">
                <button type="button" className="secondary" onClick={() => setOpenId(expanded ? null : meeting.id)}>{expanded ? 'Recolher PDFs' : `Ver PDFs (${files.length})`} <FileText size={15}/></button>
                {editable && <button type="button" className="secondary" title="Editar reunião" onClick={() => editMeeting(meeting)}><Pencil size={15}/></button>}
                {profile.role === 'admin' && <button type="button" className="secondary danger-text" title="Excluir reunião" onClick={() => void deleteMeeting(meeting)}><Trash2 size={15}/></button>}
              </div>
              {expanded && <div className="meet-details"><h4>PDFs da reunião</h4>
                {files.length === 0 && <p className="meet-help">Nenhum PDF anexado.</p>}
                {files.map(file => <div key={file.id} className="meet-file"><span><FileText size={17}/><b title={file.file_name}>{file.file_name}</b><small>{sizeLabel(file.byte_size)}</small></span><div>
                  <button className="secondary" type="button" onClick={() => void openPdf(file)}>Visualizar</button>
                  {editable && <button className="secondary danger-text" type="button" title="Remover PDF" onClick={() => void deletePdf(file)}><Trash2 size={15}/></button>}
                </div></div>)}
                {editable && <div className="meet-upload"><label><FilePlus2 size={17}/> Adicionar mais PDFs<input type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={e => void addPdfsToExisting(meeting.id, e)}/></label><small>Até 15 MB cada · máximo de 30 PDFs por reunião</small></div>}
              </div>}
            </article>;
          })}
        </div>}
      </div>
    </div>
    {viewer && <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={`PDF ${viewer.name}`}><div className="viewer"><div className="viewer-bar"><strong>{viewer.name}</strong><button type="button" onClick={closeViewer} aria-label="Fechar PDF"><X size={22}/></button></div><iframe title={`PDF: ${viewer.name}`} src={viewer.url}/></div></div>}
  </section>;
}
