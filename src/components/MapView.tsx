import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, Map, Marker, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { GeoJSONSource } from 'maplibre-gl';
import { Layers, Satellite, Search, MapPin, LocateFixed, ListFilter, Maximize2, Minimize2 } from 'lucide-react';
import type { Task } from '../lib/types';
import { friendlyError } from '../lib/types';
import { geocode } from '../lib/geocode';
import '../styles/map-classico.css';

// No MapLibre 6, Vite precisa empacotar e indicar o worker explicitamente.
// Isto evita: Worker failed to load / Check that the worker URL is correct.
setWorkerUrl(workerUrl);

// MESMA BASE DO MAPA DO APPS SCRIPT: MapLibre + OpenFreeMap Liberty.
// Mantém mapa padrão sem chave. A chave MapTiler é usada no satélite e na busca.
const STREET_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const CITY_CENTER: [number, number] = [-49.3792, -20.8202];
const CITY_ZOOM = 11;
const SOURCE_ID = 'mapa-tarefas';
const CLUSTERS_ID = 'mapa-grupos';
const CLUSTER_COUNT_ID = 'mapa-grupos-contagem';
const PINS_ID = 'mapa-pontos';
const PIN_IMAGE_ID = 'nucleo-alfinete';
const sanitizeText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, ' ').replace(/\*\*|__|#{1,6}\s?/g, '').replace(/\[[^\]]+\]\([^)]*\)/g, m => m.replace(/\]\([^)]*\)/g, '').replace(/^\[/, '')).replace(/\s+/g, ' ').trim();
function shortDescription(value: string, maxLength = 220): string {
  const cleaned = sanitizeText(value || '');
  if (!cleaned) return 'Esta demanda ainda não possui descrição cadastrada.';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength).trimEnd()}…` : cleaned;
}
const normalize = (value: string) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const isLocated = (task: Task) =>
  typeof task.latitude === 'number' && typeof task.longitude === 'number' &&
  Number.isFinite(task.latitude) && Number.isFinite(task.longitude) &&
  Math.abs(task.latitude) <= 90 && Math.abs(task.longitude) <= 180 &&
  !(task.latitude === 0 && task.longitude === 0);
const satelliteStyle = (key: string) => `https://api.maptiler.com/maps/hybrid/style.json?key=${encodeURIComponent(key)}`;
type MapMode = 'street' | 'satellite';
type PointFeature = {
  type: 'Feature';
  geometry: {type: 'Point'; coordinates: number[]};
  properties: {id: string; number: number; title: string};
};
function featureCollection(tasks: Task[]): {type: 'FeatureCollection'; features: PointFeature[]} {
  return {
    type: 'FeatureCollection',
    features: tasks.map(task => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [task.longitude!, task.latitude!]},
      properties: {id: task.id, number: task.number, title: task.title},
    })),
  };
}

// Desenha o mesmo alfinete vermelho de centro branco do mapa antigo.
function addRedPinImage(map: Map) {
  if (map.hasImage(PIN_IMAGE_ID)) return;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 88;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.beginPath();
  ctx.moveTo(32, 84);
  ctx.bezierCurveTo(23, 68, 10, 53, 10, 30);
  ctx.bezierCurveTo(10, 14, 20, 5, 32, 5);
  ctx.bezierCurveTo(44, 5, 54, 14, 54, 30);
  ctx.bezierCurveTo(54, 49, 42, 63, 32, 84);
  ctx.closePath();
  ctx.fillStyle = '#ff2341'; ctx.strokeStyle = '#14171f'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
  ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(32, 29, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
  map.addImage(PIN_IMAGE_ID, ctx.getImageData(0, 0, 64, 88), {pixelRatio: 2});
}

// Nunca injeta dados de tarefas como HTML: o texto vai por textContent.
function createTaskPopup(task: Task, onOpen: (task: Task) => void) {
  const root = document.createElement('div');
  root.className = 'nucleo-popup-task';
  const title = document.createElement('strong');
  title.className = 'nucleo-popup-task-title';
  title.textContent = task.title || 'Demanda sem título';
  const meta = document.createElement('small');
  meta.textContent = `#${task.number} · ${task.stage} · ${task.priority}`;
  const bairro = document.createElement('div');
  bairro.className = 'nucleo-popup-bairro';
  const label = document.createElement('span'); label.textContent = 'BAIRRO DA DEMANDA';
  const name = document.createElement('b'); name.textContent = task.neighborhood || 'Não informado';
  bairro.append(label, name);
  const address = document.createElement('small');
  address.textContent = [task.street, task.street_number, task.postal_code].filter(Boolean).join(', ') || 'Endereço não informado';
  const descLabel = document.createElement('span');
  descLabel.className = 'nucleo-popup-description-label';
  descLabel.textContent = 'RESUMO DA DESCRIÇÃO';
  const description = document.createElement('p');
  description.className = 'nucleo-popup-description';
  description.textContent = shortDescription(task.description);
  description.title = sanitizeText(task.description || '');
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'nucleo-popup-open';
  open.textContent = 'Visualizar descrição completa e documentos';
  open.addEventListener('click', () => onOpen(task));
  root.append(title, meta, bairro, address, descLabel, description, open);
  return root;
}

interface Props { tasks: Task[]; onOpenTask: (task: Task) => void; }
export function MapView({tasks, onOpenTask}: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapStageRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const searchMarkerRef = useRef<Marker | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  const tasksRef = useRef(tasks);
  const onOpenRef = useRef(onOpenTask);
  const visibleRef = useRef<Task[]>([]);
  const modeRef = useRef<MapMode>('street');
  const [mode, setMode] = useState<MapMode>('street');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchedNeighborhood, setSearchedNeighborhood] = useState('');
  const [onlyNeighborhood, setOnlyNeighborhood] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const key = import.meta.env.VITE_MAPTILER_KEY || '';
  const locatedTasks = tasks.filter(isLocated);
  const visibleTasks = searchedNeighborhood && onlyNeighborhood
    ? locatedTasks.filter(t => normalize(t.neighborhood).includes(normalize(searchedNeighborhood)))
    : locatedTasks;
  tasksRef.current = tasks;
  onOpenRef.current = onOpenTask;
  visibleRef.current = visibleTasks;

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const map = new Map({
      container: mapContainerRef.current,
      style: STREET_STYLE,
      center: CITY_CENTER,
      zoom: CITY_ZOOM,
      maxZoom: 19,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.addControl(new NavigationControl({showCompass: false}), 'top-left');
    mapRef.current = map;

    const syncSource = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (source) source.setData(featureCollection(visibleRef.current));
    };

    // Em toda troca Padrão/Satélite, MapLibre recria o estilo. Reinstalar as camadas de tarefas.
    const onStyleLoad = () => {
      addRedPinImage(map);
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {
          type: 'geojson', data: featureCollection(visibleRef.current),
          cluster: true, clusterMaxZoom: 15, clusterRadius: 48,
        });
      }
      if (!map.getLayer(CLUSTERS_ID)) map.addLayer({
        id: CLUSTERS_ID, type: 'circle', source: SOURCE_ID, filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#3e69c7', 10, '#3154ba', 50, '#1e3a8a'],
          'circle-radius': ['step', ['get', 'point_count'], 21, 10, 27, 50, 34],
          'circle-opacity': 0.88,
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3,
        },
      });
      if (!map.getLayer(CLUSTER_COUNT_ID)) map.addLayer({
        id: CLUSTER_COUNT_ID, type: 'symbol', source: SOURCE_ID, filter: ['has', 'point_count'],
        layout: {'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13},
        paint: {'text-color': '#ffffff'},
      });
      if (!map.getLayer(PINS_ID)) map.addLayer({
        id: PINS_ID, type: 'symbol', source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {'icon-image': PIN_IMAGE_ID, 'icon-anchor': 'bottom', 'icon-size': 1, 'icon-allow-overlap': true, 'icon-ignore-placement': true},
      });
      loadedRef.current = true;
      syncSource();
      if (!fittedRef.current) {
        fittedRef.current = true;
        if (visibleRef.current.length > 1) {
          const bounds = new LngLatBounds();
          visibleRef.current.forEach(t => bounds.extend([t.longitude!, t.latitude!]));
          map.fitBounds(bounds, {padding: 65, maxZoom: 14, duration: 0});
        } else if (visibleRef.current.length === 1) {
          map.flyTo({center: [visibleRef.current[0].longitude!, visibleRef.current[0].latitude!], zoom: 13.8, duration: 0});
        }
      }
    };
    map.on('style.load', onStyleLoad);
    map.on('click', CLUSTERS_ID, async e => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const clusterId = Number(feature.properties?.cluster_id);
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      if (!source || !Number.isFinite(clusterId)) return;
      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({center: feature.geometry.coordinates as [number, number], zoom: Math.min(zoom, 17), duration: 350});
      } catch (err) { console.warn('Falha ao aproximar grupo de demandas', err); }
    });
    map.on('click', PINS_ID, e => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const id = String(feature.properties?.id || '');
      const task = tasksRef.current.find(t => t.id === id);
      if (!task) return;
      const popup = new Popup({offset: 18, maxWidth: '340px'});
      popup.setLngLat(feature.geometry.coordinates as [number, number])
        .setDOMContent(createTaskPopup(task, currentTask => onOpenRef.current(currentTask)))
        .addTo(map);
    });
    [PINS_ID, CLUSTERS_ID].forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('error', e => {
      const message = e.error?.message || 'Falha ao carregar dados cartográficos.';
      console.warn('Erro no mapa de demandas:', message);
      // O satélite depende da chave, mas a base padrão usa OpenFreeMap sem chave.
      if (modeRef.current === 'satellite') {
        modeRef.current = 'street';
        setMode('street');
        setErrorMessage('O satélite não carregou. Voltamos ao mapa padrão; confira a chave MapTiler.');
        map.setStyle(STREET_STYLE);
      } else setErrorMessage(`Falha ao carregar parte do mapa. ${message}`);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(mapContainerRef.current);
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === mapStageRef.current);
      requestAnimationFrame(() => map.resize());
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      searchMarkerRef.current?.remove(); searchMarkerRef.current = null;
      map.remove(); mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    if (source) source.setData(featureCollection(visibleTasks));
  }, [tasks, onlyNeighborhood, searchedNeighborhood]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode === modeRef.current) return;
    if (mode === 'satellite' && !key) {
      setErrorMessage('Para usar o modo Satélite, configure VITE_MAPTILER_KEY no arquivo .env.');
      setMode('street'); return;
    }
    setErrorMessage('');
    modeRef.current = mode;
    map.setStyle(mode === 'street' ? STREET_STYLE : satelliteStyle(key));
  }, [mode, key]);

  const fitTasks = () => {
    const map = mapRef.current;
    if (!map || !locatedTasks.length) return;
    const bounds = new LngLatBounds();
    locatedTasks.forEach(task => bounds.extend([task.longitude!, task.latitude!]));
    if (locatedTasks.length > 1) map.fitBounds(bounds, {padding: 65, maxZoom: 14, duration: 550});
    else map.flyTo({center: [locatedTasks[0].longitude!, locatedTasks[0].latitude!], zoom: 14});
  };
  const clearSearch = () => {
    setQuery(''); setResult(''); setOnlyNeighborhood(false); setSearchedNeighborhood('');
    searchMarkerRef.current?.remove(); searchMarkerRef.current = null;
    mapRef.current?.flyTo({center: CITY_CENTER, zoom: CITY_ZOOM});
  };
  async function searchNeighborhood(e: React.FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (term.length < 2) {setResult('Digite pelo menos duas letras do bairro ou endereço.'); return;}
    setBusy(true); setResult('');
    try {
      const geo = await geocode(term);
      const map = mapRef.current;
      if (map) {
        map.flyTo({center: [geo.longitude, geo.latitude], zoom: 14.3, essential: true});
        searchMarkerRef.current?.remove();
        const el = document.createElement('div'); el.className = 'nucleo-bairro-pin';
        const content = document.createElement('div'); content.className = 'nucleo-bairro-popup';
        const heading = document.createElement('strong'); heading.textContent = 'Bairro pesquisado';
        const text = document.createElement('p'); text.textContent = geo.label;
        const foot = document.createElement('small'); foot.textContent = 'Posição aproximada, independente das tarefas cadastradas.';
        content.append(heading, text, foot);
        searchMarkerRef.current = new Marker({element: el, color: '#0e9ead', anchor: 'bottom'})
          .setLngLat([geo.longitude, geo.latitude])
          .setPopup(new Popup({offset: 20}).setDOMContent(content)).addTo(map);
      }
      setSearchedNeighborhood(term);
      setResult(`Local encontrado: ${geo.label}. Os pinos vermelhos representam demandas cadastradas.`);
    } catch (error) {setResult(friendlyError(error));}
    finally {setBusy(false);}
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await mapStageRef.current?.requestFullscreen();
      requestAnimationFrame(() => mapRef.current?.resize());
    } catch {setResult('Tela cheia indisponível neste navegador.');}
  }

  const withoutCoords = tasks.length - locatedTasks.length;
  return <section className="map-screen nucleo-appscript-map">
    <div className="pane-heading">
      <div><h2>Mapa de demandas</h2><p>Mapa de São José do Rio Preto com a mesma base do Apps Script, agrupamento de pinos e resumo das descrições.</p></div>
      <div className="toggle-group" role="group" aria-label="Tipo de mapa">
        <button type="button" className={mode==='street'?'selected':''} onClick={() => setMode('street')}><Layers size={16}/> Padrão</button>
        <button type="button" className={mode==='satellite'?'selected':''} onClick={() => setMode('satellite')}><Satellite size={16}/> Satélite</button>
      </div>
    </div>
    <form className="map-search" onSubmit={searchNeighborhood}>
      <MapPin size={18}/>
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Digite o nome de um bairro ou endereço" aria-label="Pesquisar bairro ou endereço"/>
      <button className="primary" type="submit" disabled={busy}><Search size={16}/>{busy?'Buscando…':'Buscar bairro'}</button>
      <button className="secondary" type="button" onClick={clearSearch}><LocateFixed size={16}/> Limpar</button>
    </form>
    <div className="map-summary">
      <span><MapPin size={15}/> <strong>{locatedTasks.length}</strong> demanda(s) localizada(s)</span>
      {withoutCoords>0&&<span className="map-pending-location">{withoutCoords} sem coordenadas — preencha o CEP ou endereço e salve a tarefa</span>}
      <button className="secondary map-fit-btn" type="button" disabled={!locatedTasks.length} onClick={fitTasks}><ListFilter size={15}/> Ver todas as demandas</button>
    </div>
    {searchedNeighborhood&&<label className="map-filter-toggle"><input type="checkbox" checked={onlyNeighborhood} onChange={e=>setOnlyNeighborhood(e.target.checked)}/> Mostrar somente demandas deste bairro</label>}
    {result&&<div className="hint" role="status">{result}</div>}
    {errorMessage&&<p className="warning" role="alert">{errorMessage}</p>}
    <div className="map-stage" ref={mapStageRef}>
      <div className="map-container" ref={mapContainerRef} aria-label="Mapa de demandas de São José do Rio Preto" role="application"/>
      <button className="map-fullscreen-button" type="button" onClick={() => void toggleFullscreen()}>
        {fullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>} {fullscreen?'Sair da tela cheia':'Tela cheia'}
      </button>
      <div className="map-legend" aria-label="Legenda do mapa">
        <span><i style={{background:'#ff2341'}}/> Vermelho: demanda</span>
        <span><i style={{background:'#3e69c7'}}/> Azul: grupo de demandas</span>
        <span><i style={{background:'#0e9ead'}}/> Azul-claro: bairro pesquisado</span>
      </div>
    </div>
    <p className="muted map-caption">Clique no pino vermelho para ler um trecho da descrição e acessar o cadastro completo. Agrupamentos azuis podem ser ampliados. A localização por CEP pode ser aproximada.</p>
  </section>;
}
