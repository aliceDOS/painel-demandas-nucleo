-- Teste do trigger: execute no SQL Editor APÓS a migration; nenhuma alteração persiste.
begin;
do $$
declare
  test_task uuid;
  a uuid;
  b uuid;
  etapa text;
begin
  insert into public.tasks(title,description,stage) values ('Teste de avanço automático','Teste descartável','Backlog') returning id into test_task;
  insert into public.checklist_items(task_id,title,position) values (test_task,'Primeiro passo',0) returning id into a;
  insert into public.checklist_items(task_id,title,position) values (test_task,'Segundo passo',1) returning id into b;

  update public.checklist_items set is_done=true where id=a;
  select stage into etapa from public.tasks where id=test_task;
  if etapa <> 'Backlog' then raise exception 'FALHA: avançou antes do último item: %', etapa; end if;

  update public.checklist_items set is_done=true where id=b;
  select stage into etapa from public.tasks where id=test_task;
  if etapa <> 'Em análise' then raise exception 'FALHA: etapa após último item: %', etapa; end if;

  update public.checklist_items set is_done=false where id=a;
  select stage into etapa from public.tasks where id=test_task;
  if etapa <> 'Em análise' then raise exception 'FALHA: regrediu ao desmarcar: %', etapa; end if;

  update public.checklist_items set is_done=true where id=a;
  select stage into etapa from public.tasks where id=test_task;
  if etapa <> 'Em andamento' then raise exception 'FALHA: não avançou novamente ao concluir um novo ciclo: %', etapa; end if;

  raise notice 'OK: último item conclui, avança uma coluna, não regride automaticamente.';
end
$$;
rollback;
