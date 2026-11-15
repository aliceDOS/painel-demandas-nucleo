// Edge Function: imagens/PDFs privados no Google Drive, metadados no Supabase.
// Requer user JWT válido, conta ativa, RLS; credenciais privadas SOMENTE no servidor.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const PUBLIC_KEY = Deno.env.get('NUCLEO_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const SECRET_KEY = Deno.env.get('NUCLEO_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
const uuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT_IMAGE = 8 * 1024 * 1024;
const LIMIT_PDF = 15 * 1024 * 1024;
const mimeTypes = ['image/jpeg','image/png','image/webp','application/pdf'];
const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function cors(origin: string | null): Record<string,string> {
  const ok = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-task-id,x-file-name',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Type,Content-Disposition',
  };
}
function json(body: unknown, status: number, h: Record<string,string>) {
  return new Response(JSON.stringify(body), { status, headers: {...h, 'Content-Type': 'application/json; charset=utf-8' } });
}
function safeName(raw: string): string {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* mantém nome */ }
  return decoded.replace(/[\\/\u0000-\u001f<>"|]/g, '_').trim().slice(0, 220) || 'arquivo';
}
function validFile(mime: string, bytes: Uint8Array): boolean {
  const starts = (sig: number[], off = 0) => sig.every((n,i) => bytes[i+off] === n);
  if (mime === 'application/pdf') return starts([37,80,68,70,45]);
  if (mime === 'image/jpeg') return starts([255,216,255]);
  if (mime === 'image/png') return starts([137,80,78,71,13,10,26,10]);
  if (mime === 'image/webp') return starts([82,73,70,70]) && starts([87,69,66,80],8);
  return false;
}
async function googleToken(): Promise<string> {
  const client_id = Deno.env.get('GOOGLE_CLIENT_ID');
  const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  const refresh_token = Deno.env.get('GOOGLE_REFRESH_TOKEN');
  if (!client_id || !client_secret || !refresh_token) throw new Error('OAuth Google não configurado no servidor');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({client_id, client_secret, refresh_token, grant_type:'refresh_token'}),
  });
  if (!resp.ok) throw new Error(`Google OAuth: HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('O Google não retornou token de acesso');
  return data.access_token as string;
}
async function uploadDrive(file: Uint8Array, name: string, mime: string): Promise<string> {
  const folder = Deno.env.get('GOOGLE_DRIVE_FOLDER_ID');
  if (!folder) throw new Error('GOOGLE_DRIVE_FOLDER_ID ausente');
  const token = await googleToken();
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8',
      'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(file.length),
    },
    body: JSON.stringify({ name, mimeType: mime, parents: [folder] }),
  });
  if (!start.ok) throw new Error(`Iniciar upload do Drive: HTTP ${start.status}`);
  const location = start.headers.get('Location');
  if (!location || !new URL(location).hostname.endsWith('.googleapis.com')) throw new Error('URL de upload inválida');
  const done = await fetch(location, {
    method:'PUT',
    headers: { Authorization:`Bearer ${token}`, 'Content-Type':mime, 'Content-Length':String(file.length) },
    body: file,
  });
  if (!done.ok) throw new Error(`Salvar no Drive: HTTP ${done.status}`);
  const result = await done.json();
  if (!result.id) throw new Error('Google Drive não retornou ID de arquivo');
  return String(result.id);
}
async function deleteDrive(driveId: string) {
  const token = await googleToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?supportsAllDrives=true`, {
    method:'DELETE', headers:{ Authorization:`Bearer ${token}` },
  });
  if (!resp.ok && resp.status !== 404) throw new Error(`Excluir arquivo Drive: HTTP ${resp.status}`);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin');
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({error:'Origem não autorizada'},403,headers);
  if (!SUPABASE_URL || !PUBLIC_KEY || !SECRET_KEY) return json({error:'Servidor não configurado'},503,headers);
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const jwt = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1] ?? '';
    if (!jwt) return json({error:'É necessário entrar na conta'},401,headers);
    const userClient = createClient(SUPABASE_URL,PUBLIC_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userErr} = await userClient.auth.getUser(jwt);
    if (userErr || !user) return json({error:'Sessão inválida'},401,headers);
    const {data:profile,error:profileErr} = await admin.from('profiles')
      .select('role,is_active').eq('id',user.id).single();
    if (profileErr || !profile?.is_active) return json({error:'Conta não liberada pelo administrador'},403,headers);
    const canEdit = profile.role === 'editor' || profile.role === 'admin';
    const params = new URL(request.url).searchParams;
    const action = params.get('action');
    if (action === 'upload' && request.method === 'POST') {
      if (!canEdit) return json({error:'Somente editores podem anexar arquivos'},403,headers);
      const taskId = request.headers.get('x-task-id') ?? '';
      if (!uuidRx.test(taskId)) return json({error:'Tarefa inválida'},400,headers);
      const {data:task} = await admin.from('tasks').select('id').eq('id',taskId).maybeSingle();
      if (!task) return json({error:'Tarefa inexistente'},404,headers);
      const {count} = await admin.from('task_attachments').select('id',{count:'exact',head:true}).eq('task_id',taskId);
      if ((count ?? 0) >= 60) return json({error:'Limite de 60 anexos por tarefa'},400,headers);
      const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!mimeTypes.includes(mime)) return json({error:'Use JPG, PNG, WEBP ou PDF'},415,headers);
      const max = mime === 'application/pdf' ? LIMIT_PDF : LIMIT_IMAGE;
      const advertised = Number(request.headers.get('content-length') ?? 0);
      if (advertised > max) return json({error:'Arquivo muito grande'},413,headers);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length || bytes.length > max || !validFile(mime,bytes))
        return json({error:'Arquivo vazio, inválido ou acima do limite'},400,headers);
      const name = safeName(request.headers.get('x-file-name') || 'arquivo');
      const driveId = await uploadDrive(bytes,`${taskId}_${crypto.randomUUID()}_${name}`,mime);
      const {data:attachment,error:insertErr} = await admin.from('task_attachments').insert({
        task_id:taskId, drive_file_id:driveId, file_name:name,
        mime_type:mime, byte_size:bytes.length,uploaded_by:user.id,
      }).select('id,task_id,file_name,mime_type,byte_size,created_at,uploaded_by').single();
      if (insertErr) {
        try { await deleteDrive(driveId); } catch (cleanup) { console.error('Falha ao limpar anexo órfão',cleanup); }
        throw new Error('Não foi possível registrar o anexo no Supabase');
      }
      return json({attachment},201,headers);
    }
    if ((action === 'download' && request.method === 'GET') ||
        (action === 'delete' && request.method === 'DELETE')) {
      const id = params.get('id') || '';
      if (!uuidRx.test(id)) return json({error:'Anexo inválido'},400,headers);
      const {data:attachment,error:findErr} = await admin.from('task_attachments')
        .select('id,drive_file_id,file_name,mime_type').eq('id',id).maybeSingle();
      if (findErr || !attachment) return json({error:'Anexo não encontrado'},404,headers);
      if (action === 'delete') {
        if (!canEdit) return json({error:'Sem autorização para remover anexos'},403,headers);
        // Se o Drive falhar, o registro permanece, permitindo uma nova tentativa.
        await deleteDrive(attachment.drive_file_id);
        const {error:deleteErr} = await admin.from('task_attachments').delete().eq('id',id);
        if (deleteErr) throw new Error('Arquivo removido do Drive; falha ao atualizar registro. Consulte o administrador.');
        return json({ok:true},200,headers);
      }
      const token = await googleToken();
      const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(attachment.drive_file_id)}?alt=media&supportsAllDrives=true`,{
        headers:{Authorization:`Bearer ${token}`},
      });
      if (!driveResponse.ok || !driveResponse.body) throw new Error(`Drive: não foi possível abrir o anexo (HTTP ${driveResponse.status})`);
      return new Response(driveResponse.body,{status:200,headers:{
        ...headers, 'Content-Type':attachment.mime_type, 'Cache-Control':'private, max-age=60',
        'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
        'X-Content-Type-Options':'nosniff',
      }});
    }
    return json({error:'Operação inválida'},404,headers);
  } catch (error) {
    console.error('drive-file:',error);
    return json({error:error instanceof Error ? error.message : 'Falha no serviço de arquivos'},500,headers);
  }
});
