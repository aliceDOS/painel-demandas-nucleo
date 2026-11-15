// PDFs de pautas e reuniões: OAuth Google Drive privado; dados no Supabase.
// Utilize os mesmos 7 segredos já cadastrados para a função drive-file.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const PUBLIC = Deno.env.get('NUCLEO_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const SECRET = Deno.env.get('NUCLEO_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s=>s.trim()).filter(Boolean);
const PDF_MAX = 15 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const admin = createClient(SB_URL, SECRET, {auth:{persistSession:false,autoRefreshToken:false}});
const cors = (origin:string|null):Record<string,string>=>({
  ...(origin && ALLOWED.includes(origin) ? {'Access-Control-Allow-Origin':origin}:{}),
  'Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-meeting-id,x-file-name',
  'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS',
  'Access-Control-Expose-Headers':'Content-Type,Content-Disposition',
});
const respond=(message:unknown,status:number,headers:Record<string,string>)=>new Response(JSON.stringify(message),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
function cleanName(raw:string):string {
  let name=raw;
  try{name=decodeURIComponent(raw)}catch{ /* keep original */ }
  return name.replace(/[\\/\u0000-\u001f<>"|]/g,'_').trim().slice(0,220)||'pauta.pdf';
}
async function googleToken():Promise<string>{
  const id=Deno.env.get('GOOGLE_CLIENT_ID')||'';
  const secret=Deno.env.get('GOOGLE_CLIENT_SECRET')||'';
  const refresh=Deno.env.get('GOOGLE_REFRESH_TOKEN')||'';
  if(!id||!secret||!refresh)throw new Error('Credenciais Google OAuth incompletas');
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'}),
  });
  if(!response.ok)throw new Error(`Google OAuth: HTTP ${response.status}`);
  const data=await response.json();
  if(!data.access_token)throw new Error('O Google não retornou token');
  return data.access_token as string;
}
async function uploadDrive(bytes:Uint8Array,name:string):Promise<string>{
  // Pasta exclusiva de PDFs das reuniões; não usar a pasta de anexos das tarefas.
  const folder=Deno.env.get('GOOGLE_DRIVE_MEETINGS_FOLDER_ID');
  if(!folder)throw new Error('Pasta de reuniões não configurada: cadastre GOOGLE_DRIVE_MEETINGS_FOLDER_ID nas Funções Edge > Segredos.');
  const token=await googleToken();
  const initial=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id&supportsAllDrives=true',{
    method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json; charset=utf-8','X-Upload-Content-Type':'application/pdf','X-Upload-Content-Length':String(bytes.length)},
    body:JSON.stringify({name,mimeType:'application/pdf',parents:[folder]}),
  });
  if(!initial.ok)throw new Error(`Iniciar upload do Drive: HTTP ${initial.status}`);
  const location=initial.headers.get('Location');
  if(!location||!new URL(location).hostname.endsWith('.googleapis.com'))throw new Error('Destino do upload inválido');
  const done=await fetch(location,{method:'PUT',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/pdf'},body:bytes});
  if(!done.ok)throw new Error(`Salvar no Drive: HTTP ${done.status}`);
  const obj=await done.json();
  if(!obj.id)throw new Error('Google não retornou o ID do PDF');
  return String(obj.id);
}
async function deleteDrive(id:string){
  const token=await googleToken();
  const result=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
  if(!result.ok && result.status!==404)throw new Error(`Excluir do Drive: HTTP ${result.status}`);
}
Deno.serve(async(request:Request)=>{
  const origin=request.headers.get('Origin');const headers=cors(origin);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(origin && !ALLOWED.includes(origin))return respond({error:'Origem não autorizada'},403,headers);
  if(!SB_URL||!PUBLIC||!SECRET)return respond({error:'Segredos do Supabase não configurados'},503,headers);
  try{
    const match=/^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization')||'');
    if(!match)return respond({error:'Entre na sua conta'},401,headers);
    const auth=createClient(SB_URL,PUBLIC,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userError}=await auth.auth.getUser(match[1]);
    if(userError||!user)return respond({error:'Sessão inválida'},401,headers);
    const {data:profile}=await admin.from('profiles').select('role,is_active').eq('id',user.id).maybeSingle();
    if(!profile?.is_active)return respond({error:'Conta sem autorização'},403,headers);
    const canEdit=profile.role==='admin'||profile.role==='editor';
    const params=new URL(request.url).searchParams;const action=params.get('action');
    if(action==='upload'&&request.method==='POST'){
      if(!canEdit)return respond({error:'Somente editores podem anexar PDFs'},403,headers);
      const meetingId=request.headers.get('x-meeting-id')||'';
      if(!UUID.test(meetingId))return respond({error:'Reunião inválida'},400,headers);
      const {data:meeting}=await admin.from('meetings').select('id').eq('id',meetingId).maybeSingle();
      if(!meeting)return respond({error:'Reunião não encontrada'},404,headers);
      const {count}=await admin.from('meeting_attachments').select('id',{head:true,count:'exact'}).eq('meeting_id',meetingId);
      if((count||0)>=30)return respond({error:'Máximo de 30 PDFs por reunião'},400,headers);
      if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/pdf')return respond({error:'Somente PDF'},415,headers);
      const cl=Number(request.headers.get('content-length')||0);
      if(cl>PDF_MAX)return respond({error:'PDF acima de 15 MB'},413,headers);
      const bytes=new Uint8Array(await request.arrayBuffer());
      if(!bytes.length||bytes.length>PDF_MAX||![37,80,68,70,45].every((v,i)=>bytes[i]===v))return respond({error:'PDF inválido ou acima do limite de 15 MB'},400,headers);
      const fileName=cleanName(request.headers.get('x-file-name')||'pauta.pdf');
      const driveId=await uploadDrive(bytes,`reuniao_${meetingId}_${crypto.randomUUID()}_${fileName}`);
      const {data:attachment,error:insertError}=await admin.from('meeting_attachments').insert({meeting_id:meetingId,drive_file_id:driveId,file_name:fileName,mime_type:'application/pdf',byte_size:bytes.length,uploaded_by:user.id}).select('id,meeting_id,file_name,mime_type,byte_size,created_at').single();
      if(insertError){try{await deleteDrive(driveId)}catch(e){console.error('Falha ao limpar PDF órfão:',e)};throw new Error('Erro ao salvar registro do PDF no Supabase')}
      return respond({attachment},201,headers);
    }
    if((action==='download'&&request.method==='GET')||(action==='delete'&&request.method==='DELETE')){
      const id=params.get('id')||'';
      if(!UUID.test(id))return respond({error:'ID inválido'},400,headers);
      const {data:attachment}=await admin.from('meeting_attachments').select('id,drive_file_id,file_name').eq('id',id).maybeSingle();
      if(!attachment)return respond({error:'PDF não encontrado'},404,headers);
      if(action==='delete'){
        if(!canEdit)return respond({error:'Sem autorização para excluir PDFs'},403,headers);
        await deleteDrive(attachment.drive_file_id);
        const {error:removeError}=await admin.from('meeting_attachments').delete().eq('id',id);
        if(removeError)throw new Error('PDF removido do Drive; erro ao apagar o registro. Contate o administrador.');
        return respond({ok:true},200,headers);
      }
      const token=await googleToken();
      const download=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attachment.drive_file_id)}?alt=media&supportsAllDrives=true`,{headers:{Authorization:`Bearer ${token}`}});
      if(!download.ok||!download.body)throw new Error(`Não foi possível abrir o PDF (Drive HTTP ${download.status})`);
      return new Response(download.body,{status:200,headers:{...headers,'Content-Type':'application/pdf','Cache-Control':'private, max-age=60','Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,'X-Content-Type-Options':'nosniff'}});
    }
    return respond({error:'Operação inválida'},404,headers);
  }catch(err){console.error('meeting-files:',err);return respond({error:err instanceof Error?err.message:'Falha na integração'},500,headers)}
});
