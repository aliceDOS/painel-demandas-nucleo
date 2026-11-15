-- Núcleo de Articulação V2: pautas e documentos de reuniões, independentes do Kanban.
-- Executar somente no projeto Supabase V2 que já possui 001_schema.sql.
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  title varchar(180) not null check (length(trim(title)) >= 2),
  meeting_date date not null,
  meeting_time time without time zone,
  department varchar(160) not null default '',
  location varchar(180) not null default '',
  agenda text not null default '' check (length(agenda) <= 10000),
  notes text not null default '' check (length(notes) <= 10000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_meetings_date on public.meetings(meeting_date desc, created_at desc);

create table if not exists public.meeting_attachments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  drive_file_id text not null unique,
  file_name varchar(220) not null,
  mime_type varchar(90) not null default 'application/pdf' check (mime_type = 'application/pdf'),
  byte_size bigint not null check (byte_size between 1 and 15728640),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_meeting_attachments_meeting on public.meeting_attachments(meeting_id, created_at);

-- O trigger de data já existe no script original do Kanban.
drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at before update on public.meetings
for each row execute function public.nucleo_update_timestamp();

alter table public.meetings enable row level security;
alter table public.meeting_attachments enable row level security;

-- Somente colaboradores ativos visualizam. Editores podem cadastrar/alterar;
-- administradores são os únicos que excluem reuniões inteiras.
create policy meetings_read on public.meetings for select to authenticated
using ((select public.nucleo_member()));
create policy meetings_insert on public.meetings for insert to authenticated
with check ((select public.nucleo_editor()) and created_by = (select auth.uid()));
create policy meetings_update on public.meetings for update to authenticated
using ((select public.nucleo_editor())) with check ((select public.nucleo_editor()));
create policy meetings_delete on public.meetings for delete to authenticated
using ((select public.nucleo_admin()));
create policy meeting_attachments_read on public.meeting_attachments for select to authenticated
using ((select public.nucleo_member()));
-- Os arquivos só são inseridos/apagados pela Edge Function após validar JWT e perfil.

grant select,insert,update,delete on public.meetings to authenticated;
grant select on public.meeting_attachments to authenticated;

-- Opcional: notificação das novas pautas na interface.
alter publication supabase_realtime add table public.meetings, public.meeting_attachments;
