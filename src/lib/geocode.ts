import type { TaskInput } from './types';

export interface GeocodeResult { longitude: number; latitude: number; label: string; }
export interface LocatedTask extends GeocodeResult {
  address: Pick<TaskInput, 'street' | 'neighborhood' | 'city'>;
  approximate: boolean;
}

export async function geocode(place: string): Promise<GeocodeResult> {
  const key = import.meta.env.VITE_MAPTILER_KEY;
  if (!key) throw new Error('Configure VITE_MAPTILER_KEY para localizar endereços e CEPs.');
  const query = /rio preto/i.test(place) ? place : `${place}, São José do Rio Preto, São Paulo, Brasil`;
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${encodeURIComponent(key)}&language=pt&country=br&limit=5`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível consultar o endereço (HTTP ${response.status}).`);
  const data = await response.json();
  const features = Array.isArray(data.features) ? data.features as Array<{
    center?: number[]; place_name?: string;
  }> : [];
  const candidate = features.find(f => Array.isArray(f.center) && f.center.length >= 2 && Number.isFinite(f.center[0]) && Number.isFinite(f.center[1]));
  if (!candidate?.center) throw new Error('Bairro, CEP ou endereço não encontrado. Verifique o CEP e informe a rua ou bairro.');
  return { longitude: candidate.center[0], latitude: candidate.center[1], label: candidate.place_name || place };
}

/**
 * Consulta pública de CEP para enriquecer a busca. Não guarda dados nem exige API extra.
 * Um CEP pode cobrir várias edificações: nunca o apresenta como número exato.
 */
export async function locateTaskAddress(form: TaskInput): Promise<LocatedTask> {
  const cep = form.postal_code.replace(/\D/g, '');
  let street = form.street.trim();
  let neighborhood = form.neighborhood.trim();
  let city = form.city.trim() || 'São José do Rio Preto';
  if (cep.length === 8) {
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (response.ok) {
        const data = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
        if (!data.erro && (!data.uf || data.uf === 'SP')) {
          street ||= (data.logradouro || '').trim();
          neighborhood ||= (data.bairro || '').trim();
          city = (data.localidade || '').trim() || city;
        }
      }
    } catch { /* Caso ViaCEP esteja indisponível, tenta geocodificar o CEP fornecido. */ }
  }
  const address = {street, neighborhood, city};
  const detailed = (street || neighborhood)
    ? [street && `${street}${form.street_number.trim() ? `, ${form.street_number.trim()}` : ''}`, neighborhood, city, 'SP', 'Brasil'].filter(Boolean).join(', ')
    : ''; 
  const tries = [detailed, cep ? `${cep}, ${city}, SP, Brasil` : ''].filter(Boolean);
  if (!tries.length) throw new Error('Informe um CEP, bairro ou rua para localizar a demanda.');
  let lastError: unknown;
  for (const q of tries) {
    try {
      const result = await geocode(q);
      return {...result, address, approximate: !street || !form.street_number.trim()};
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error('Não foi possível localizar o CEP informado.');
}
