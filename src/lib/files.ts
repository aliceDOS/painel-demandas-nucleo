import axios from 'axios';
import { supabase } from './supabase';
import type { TaskAttachment } from './types';

const apiRoot = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-file`;
async function authHeaders() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session?.access_token) throw new Error('Sessão expirada. Entre novamente.');
  return {
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}
export async function sendFile(taskId: string, file: File, onProgress: (percent: number) => void) {
  const headers = await authHeaders();
  const response = await axios.post<{ attachment: TaskAttachment }>(`${apiRoot}?action=upload`, file, {
    headers: { ...headers, 'Content-Type': file.type, 'x-task-id': taskId,
      'x-file-name': encodeURIComponent(file.name) },
    onUploadProgress: evt => {
      if (evt.total) onProgress(Math.min(95, Math.round((evt.loaded / evt.total) * 95)));
    },
    timeout: 120000,
  });
  onProgress(100);
  return response.data.attachment;
}
export async function downloadFile(id: string): Promise<Blob> {
  const headers = await authHeaders();
  const response = await axios.get<Blob>(`${apiRoot}?action=download&id=${encodeURIComponent(id)}`, {
    headers, responseType: 'blob', timeout: 120000,
  });
  return response.data;
}
export async function removeFile(id: string) {
  const headers = await authHeaders();
  await axios.delete(`${apiRoot}?action=delete&id=${encodeURIComponent(id)}`, { headers });
}
export const formatSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
