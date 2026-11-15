export const STAGES = ['Backlog', 'Em análise', 'Em andamento', 'Em validação', 'Concluído'] as const;
export type Stage = typeof STAGES[number];
export const PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'] as const;
export type Priority = typeof PRIORITIES[number];
export type Role = 'admin' | 'editor' | 'viewer';
export interface Profile { id: string; display_name: string; role: Role; is_active: boolean; }
export interface Task {
  id: string; number: number; title: string; description: string;
  stage: Stage; priority: Priority; due_date: string | null;
  responsible: string; organization: string; neighborhood: string;
  city: string; street: string; street_number: string; postal_code: string;
  latitude: number | null; longitude: number | null;
  created_at: string; updated_at: string; created_by: string | null;
}
export interface ChecklistItem {
  id: string; task_id: string; title: string; is_done: boolean; position: number; created_at: string;
}
export interface TaskComment {
  id: string; task_id: string; body: string; author_id: string; created_at: string;
  profiles?: { display_name: string } | null;
}
export interface TaskAttachment {
  id: string; task_id: string; file_name: string; mime_type: string;
  byte_size: number; created_at: string; uploaded_by: string;
}
export interface TaskPerson {
  id: string; task_id: string; name: string; created_at: string;
}
export type TaskInput = Pick<Task, 'title' | 'description' | 'stage' | 'priority' | 'due_date' | 'responsible' | 'organization' | 'neighborhood' | 'city' | 'street' | 'street_number' | 'postal_code' | 'latitude' | 'longitude'>;
export const blankTask = (stage: Stage = 'Backlog'): TaskInput => ({
  title: '', description: '', stage, priority: 'Média', due_date: null,
  responsible: '', organization: '', neighborhood: '', city: 'São José do Rio Preto',
  street: '', street_number: '', postal_code: '', latitude: null, longitude: null,
});
export const friendlyError = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Erro inesperado. Tente novamente.';
