import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject, TouchEvent } from 'react';
import { ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Paperclip, Trash2, UploadCloud, X, Eye, LoaderCircle } from 'lucide-react';
import { downloadFile, formatSize, removeFile, sendFile } from '../lib/files';
import { friendlyError } from '../lib/types';
import type { TaskAttachment } from '../lib/types';
import '../styles/gallery.css';

interface Props {
  taskId: string;
  attachments: TaskAttachment[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  alert: (s: string) => void;
}
type Pending = { id: string; file: File; url: string | null; progress: number; status: 'pendente'|'enviando'|'concluido'|'erro'; error?: string };

type ViewerProps = {
  item: TaskAttachment;
  images: TaskAttachment[];
  index: number;
  cachedUrls: RefObject<Map<string, string>>;
  onNavigate: (direction: number) => void;
  onChoose: (item: TaskAttachment) => void;
  onClose: () => void;
};

function AttachmentViewer({ item, images, index, cachedUrls, onNavigate, onChoose, onClose }: ViewerProps) {
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const touchStart = useRef<{x: number; y: number} | null>(null);
  const isImage = item.mime_type.startsWith('image/');
  const hasNavigation = isImage && images.length > 1;

  // Reaproveita a miniatura já carregada. Só busca no Drive quando necessário.
  useEffect(() => {
    let active = true;
    let temporaryUrl: string | null = null;
    const cached = isImage ? cachedUrls.current.get(item.id) : undefined;
    if (cached) {
      setSource(cached);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setSource(null);
    setError('');
    downloadFile(item.id).then(blob => {
      temporaryUrl = URL.createObjectURL(blob);
      if (active) setSource(temporaryUrl);
      else URL.revokeObjectURL(temporaryUrl);
    }).catch(err => {
      if (active) setError(friendlyError(err));
    }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
    };
  }, [item.id, isImage, cachedUrls]);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (hasNavigation && event.key === 'ArrowLeft') { event.preventDefault(); onNavigate(-1); }
      else if (hasNavigation && event.key === 'ArrowRight') { event.preventDefault(); onNavigate(1); }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [hasNavigation, onNavigate, onClose]);

  function onTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (!touchStart.current || !hasNavigation) return;
    const dx = event.changedTouches[0].clientX - touchStart.current.x;
    const dy = event.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) onNavigate(dx < 0 ? 1 : -1);
  }

  return (
    <div className="photo-gallery-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="photo-gallery-panel" role="dialog" aria-modal="true" aria-label={`Visualização de ${item.file_name}`}>
        <div className="photo-gallery-header">
          <div className="photo-gallery-title">
            <strong title={item.file_name}>{item.file_name}</strong>
            {isImage && <span>{index + 1} de {images.length} foto{images.length === 1 ? '' : 's'}</span>}
          </div>
          <button type="button" className="photo-gallery-close" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar visualização"><X size={24}/></button>
        </div>
        <div className="photo-gallery-stage"
          onTouchStart={event => { touchStart.current = {x: event.touches[0].clientX, y: event.touches[0].clientY}; }}
          onTouchEnd={onTouchEnd}
          onTouchCancel={() => { touchStart.current = null; }}>
          {hasNavigation && <button type="button" className="photo-gallery-arrow photo-gallery-prev" aria-label="Foto anterior" title="Foto anterior (←)" onClick={() => onNavigate(-1)}><ChevronLeft size={32}/></button>}
          {loading && <div className="photo-gallery-message"><LoaderCircle size={28} className="spin"/> Carregando arquivo...</div>}
          {!loading && error && <div className="photo-gallery-message photo-gallery-error">Não foi possível abrir este arquivo: {error}</div>}
          {!loading && !error && source && (isImage
            ? <img className="photo-gallery-main-img" src={source} alt={item.file_name} draggable={false}/>
            : <iframe className="photo-gallery-pdf" src={source} title={`PDF: ${item.file_name}`}/>)}
          {hasNavigation && <button type="button" className="photo-gallery-arrow photo-gallery-next" aria-label="Próxima foto" title="Próxima foto (→)" onClick={() => onNavigate(1)}><ChevronRight size={32}/></button>}
        </div>
        {isImage && <div className="photo-gallery-footer">
          <div className="photo-gallery-filmstrip" aria-label="Outras fotos desta tarefa">
            {images.map((image, imageIndex) => (
              <button type="button" key={image.id} className={`photo-gallery-film-item ${image.id === item.id ? 'active' : ''}`}
                onClick={() => onChoose(image)} title={image.file_name} aria-label={`Visualizar foto ${imageIndex + 1}`} aria-current={image.id === item.id ? 'true' : undefined}>
                {cachedUrls.current.get(image.id)
                  ? <img src={cachedUrls.current.get(image.id)} alt="" loading="lazy" />
                  : <ImageIcon size={20} />}
                <span>{imageIndex + 1}</span>
              </button>
            ))}
          </div>
          <small>{hasNavigation ? 'Use as setas, clique nas miniaturas ou deslize para passar as fotos' : 'Pressione Esc para fechar'}</small>
        </div>}
      </div>
    </div>
  );
}

function FileItem({item,canEdit,onChanged,alert,onOpen,onPreview}: {
  item:TaskAttachment;canEdit:boolean;onChanged:()=>Promise<void>;alert:(s:string)=>void;
  onOpen:(item:TaskAttachment)=>void;onPreview:(id:string,url:string|null)=>void;
}) {
  const [url,setUrl]=useState<string | null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const isImage=item.mime_type.startsWith('image/');
  useEffect(()=>{
    if (!isImage) return;
    let active=true;
    let objectUrl:string | null=null;
    downloadFile(item.id).then(blob=>{
      objectUrl=URL.createObjectURL(blob);
      if(active) { setUrl(objectUrl);onPreview(item.id,objectUrl); }
      else URL.revokeObjectURL(objectUrl);
    }).catch(()=>{if(active)setError('Miniatura indisponível');});
    return ()=>{
      active=false;
      if(objectUrl) { onPreview(item.id,null);URL.revokeObjectURL(objectUrl); }
    };
  },[item.id,isImage,onPreview]);
  async function remove(){
    if(!window.confirm(`Remover definitivamente o anexo "${item.file_name}" do Google Drive e desta tarefa?`))return;
    setLoading(true);
    try{await removeFile(item.id);await onChanged();alert('Anexo removido.');}
    catch(err){alert(friendlyError(err));}finally{setLoading(false);}
  }
  return <div className="file-tile">
    <button className="file-thumb" title={`Visualizar ${item.file_name}`} onClick={()=>onOpen(item)} type="button" disabled={loading}>
      {isImage&&url?<img src={url} alt={item.file_name} loading="lazy"/>:
        item.mime_type==='application/pdf'?<FileText size={35}/>:<ImageIcon size={34}/>}
    </button>
    <div className="file-label" title={item.file_name}>{item.file_name}</div>
    <small className="muted">{formatSize(item.byte_size)}</small>
    {error&&<small className="danger-text">{error}</small>}
    <div className="file-actions">
      <button type="button" onClick={()=>onOpen(item)} disabled={loading} title="Visualizar"><Eye size={16}/></button>
      {canEdit&&<button type="button" onClick={remove} disabled={loading} title="Remover com autorização"><Trash2 size={16}/></button>}
    </div>
  </div>;
}

export function Attachments({taskId,attachments,canEdit,onChanged,alert}: Props){
  const [pending,setPending]=useState<Pending[]>([]);
  const [uploading,setUploading]=useState(false);
  const [selected,setSelected]=useState<TaskAttachment|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const urlsRef=useRef<string[]>([]);
  const previewUrls=useRef<Map<string,string>>(new Map());
  const images=useMemo(()=>attachments.filter(a=>a.mime_type.startsWith('image/')),[attachments]);
  const imageIndex=selected ? images.findIndex(i=>i.id===selected.id) : -1;
  const onPreview=useCallback((id:string,url:string|null)=>{
    if(url)previewUrls.current.set(id,url);
    else previewUrls.current.delete(id);
  },[]);
  const closeViewer=useCallback(()=>setSelected(null),[]);
  const navigate=useCallback((direction:number)=>{
    setSelected(current=>{
      if(!current)return null;
      const index=images.findIndex(a=>a.id===current.id);
      if(index<0||images.length===0)return current;
      return images[(index + direction + images.length) % images.length];
    });
  },[images]);

  useEffect(()=>()=>{urlsRef.current.forEach(u=>URL.revokeObjectURL(u));},[]);
  useEffect(()=>{if(selected&&!attachments.some(a=>a.id===selected.id))setSelected(null);},[attachments,selected]);
  function addFiles(files:FileList|null){
    if(!files)return;
    const entries=[...files].map(file=>{
      const url=file.type.startsWith('image/')?URL.createObjectURL(file):null;
      if(url)urlsRef.current.push(url);
      return {id:crypto.randomUUID(),file,url,progress:0,status:'pendente' as const};
    });
    setPending(old=>[...old,...entries]);
    if(fileRef.current)fileRef.current.value='';
  }
  function discard(id:string){setPending(old=>{const match=old.find(f=>f.id===id);if(match?.url){URL.revokeObjectURL(match.url);urlsRef.current=urlsRef.current.filter(x=>x!==match.url);}return old.filter(x=>x.id!==id);});}
  function patch(id:string,change:Partial<Pending>){setPending(old=>old.map(x=>x.id===id?{...x,...change}:x));}
  async function sendAll(){
    setUploading(true);let count=0;
    for(const entry of pending.filter(e=>e.status==='pendente'||e.status==='erro')){
      const max=entry.file.type==='application/pdf'?15*1024*1024:8*1024*1024;
      if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(entry.file.type)||entry.file.size>max){
        patch(entry.id,{status:'erro',error:'Formato inválido ou arquivo acima do limite'});continue;
      }
      patch(entry.id,{status:'enviando',progress:0,error:undefined});
      try{await sendFile(taskId,entry.file,v=>patch(entry.id,{progress:v}));patch(entry.id,{status:'concluido',progress:100});count++;}
      catch(err){patch(entry.id,{status:'erro',error:friendlyError(err)});}
    }
    await onChanged();setUploading(false);
    if(count)alert(`${count} arquivo(s) enviado(s) ao Google Drive.`);
  }
  return <section className="detail-section">
    <div className="section-heading"><h3><Paperclip size={18}/> Fotos, PDFs e anexos</h3><span className="muted">{attachments.length} arquivo(s)</span></div>
    <div className="file-grid">
      {attachments.map(a=><FileItem key={a.id} item={a} canEdit={canEdit} onChanged={onChanged} alert={alert} onOpen={setSelected} onPreview={onPreview}/>)}
      {!attachments.length&&<p className="muted">Nenhum arquivo anexado.</p>}
    </div>
    {canEdit&&<>
      <div className="uploader">
        <input ref={fileRef} type="file" id="file-picker" accept="image/jpeg,image/png,image/webp,application/pdf" multiple
          onChange={e=>addFiles(e.target.files)}/>
        <label htmlFor="file-picker"><UploadCloud size={24}/><span><b>Adicionar fotos ou PDFs</b><small>Selecione vários arquivos de uma vez. Imagens até 8 MB; PDFs até 15 MB.</small></span></label>
      </div>
      {!!pending.length&&<div className="pending-files">
        {pending.map(p=><div className="pending-file" key={p.id}>
          {p.url?<img src={p.url} alt={p.file.name}/>:<FileText size={26}/>}
          <div className="pending-main"><div className="pending-info"><span title={p.file.name}>{p.file.name}</span><small>{p.status} · {formatSize(p.file.size)}</small></div>
          <div className="progress-track"><div style={{width:`${p.progress}%`}}/></div>
          {p.status==='enviando'&&<small className="muted">Transferindo: {p.progress}% (o Drive pode levar mais alguns segundos)</small>}
          {p.error&&<small className="danger-text">{p.error}</small>}</div>
          {p.status!=='enviando'&&<button type="button" disabled={uploading} onClick={()=>discard(p.id)} title="Remover da fila"><X size={17}/></button>}
        </div>)}
        <div className="uploader-actions">
          <button type="button" className="primary" onClick={sendAll} disabled={uploading||!pending.some(p=>p.status==='pendente'||p.status==='erro')}>
            {uploading?<LoaderCircle size={17} className="spin"/>:<UploadCloud size={17}/>} {uploading?'Enviando arquivos...':'Enviar arquivos selecionados'}
          </button>
        </div>
      </div>}
    </>}
    {selected&&<AttachmentViewer key={selected.id} item={selected} images={images} index={imageIndex} cachedUrls={previewUrls}
      onNavigate={navigate} onChoose={setSelected} onClose={closeViewer}/>}
  </section>;
}
