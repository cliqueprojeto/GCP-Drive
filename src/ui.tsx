import {ActivityPanel} from './activity-panel.tsx';
import {FavoritesPanel} from './favorites-panel.tsx';
import {UserError,userMessage} from './user-error.ts';
import {ConnectionFields} from './connection-fields.tsx';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Cloud,
  House,
  Folder,
  Star,
  Activity,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Check,
  ShieldCheck,
  HardDrive,
  X,
  ChevronRight,
  Globe,
  RefreshCw,
  ExternalLink,
  Users,
  CircleHelp,
  Bell,
  FolderSync,
  Monitor,
  CheckCheck,
  FileIcon,
} from "./system-icons.tsx";
import type {
  DriveAPI,
  Snapshot,
  Entry,
  Provider,
  Question,
  Language,
  Operations,
  FolderPreview,
  SearchHitView,
} from "./contracts.ts";
import "./ui.css";
import {providers} from './providers.ts';
import {PIX} from './support.ts';
import {builtinThemes} from './themes.ts';
import {UpdatesPanel} from './updates-panel.tsx';
declare global {
  interface Window {
    gcpDrive: DriveAPI;
  }
}
const words = {
  "pt-BR": {
    home: "Visão geral",
    files: "Meus arquivos",
    favorites: "Favoritos",
    activity: "Atividade",
    folders: "Pastas do computador",
    settings: "Preferências",
    connect: "Conectar conta",
    search: "Pesquisar nesta pasta",
    indexed: "Buscar no índice local",
    coverage:
      "Cobertura: somente pastas visitadas. Até 100 resultados; metadados podem estar desatualizados.",
    title: "Todas as suas nuvens.",
    subtitle: "Um só lugar para criar.",
    intro:
      "Seus arquivos, suas contas e suas ideias. Conectados ao seu computador com a simplicidade que o seu trabalho merece.",
    accounts: "Suas contas",
    noAccounts: "Seu espaço começa com uma conexão.",
    first: "Conecte sua primeira conta e leve seus arquivos para mais perto.",
    streaming: "Transferência por streaming",
    streamingText:
      "Acesse pela unidade virtual. Os arquivos são baixados conforme você precisa deles.",
    mirror: "Espelhamento de arquivos",
    mirrorText:
      "Em desenvolvimento · sincronização bidirecional com recuperação e resolução de conflitos.",
    connected: "contas conectadas",
    mounted: "unidades ativas",
    attention: "precisam de atenção",
    quick: "Tudo ao seu alcance",
    foldersTitle: "O que é importante fica por perto.",
    foldersText:
      "Fixe suas pastas durante a navegação. Elas aparecem aqui com seus nomes reais.",
    safe: "Seu trabalho merece cuidado.",
    safeText:
      "Login pelo provedor. Credenciais em cofre criptografado. Seus arquivos continuam nas suas nuvens.",
    open: "Abrir unidade",
    mount: "Montar unidade no sistema",
    noActivity: "As próximas atividades aparecem aqui.",
    empty: "Nenhum arquivo nesta pasta.",
    name: "Nome",
    size: "Tamanho",
    modified: "Modificado",
    state: "Estado",
    unknown: "Não verificado",
    presence: "Presença de outros editores: desconhecida",
    updated: "Sem transferências pendentes",
    syncing: "Sincronizando",
    problem: "Problema",
    ready: "Pronto para conectar",
    missing: "A instalação precisa de reparo",
    language: "Idioma",
    startup: "Iniciar com o sistema",
    save: "Salvar preferências",
    accountName: "Como quer chamar esta conta?",
    accountPlaceholder: "Ex.: Google · Trabalho",
    provider: "Escolha seu provedor",
    continue: "Continuar",
    login: "Conexão segura",
    browser:
      "A autorização acontece no navegador do seu provedor. O GCP-Drive não pede sua senha.",
    answer: "Sua resposta",
    done: "Conta conectada. Seus arquivos já podem ser explorados.",
    cancel: "Fechar",
    localTitle: "Suas pastas também fazem parte.",
    localText:
      "A seleção de pastas e a sincronização bidirecional automática estão em implementação. A versão atual oferece streaming das contas conectadas.",
    preview: "PRÉVIA DE DESENVOLVIMENTO",
    hub: "SEU ESPAÇO MULTICLOUD",
    welcome: "Seu trabalho flui melhor aqui.",
    plans: "Montagem automática ao abrir o app",
    actual: "Estados baseados em observações do motor",
    pinned: "Pastas fixadas",
    loading: "Consultando sua nuvem…",
    secureLogin: "Autorizar no navegador",
    pending: "Preparando a conexão…",
    engineNote:
      "O GCP-Drive inclui seu mecanismo de arquivos e verifica o suporte a unidades virtuais. Você não precisa configurar ferramentas separadas.",
    back: "Voltar",
    root: "Raiz",
    work: "Gestão Cultural Pro",
    footer: "Feito para o seu trabalho fluir.",
    favoritesEmpty: "Você ainda não fixou pastas.",
    betaNote:
      "Versão inicial. Validação com contas reais e em Linux/macOS pendente.",
  },
  en: {
    home: "Overview",
    files: "My files",
    favorites: "Favorites",
    activity: "Activity",
    folders: "Computer folders",
    settings: "Preferences",
    connect: "Connect account",
    search: "Search this folder",
    indexed: "Search local index",
    coverage:
      "Coverage: visited folders only. Up to 100 results; metadata may be stale.",
    title: "All your clouds.",
    subtitle: "One place to create.",
    intro:
      "Your files, accounts and ideas. Connected to your computer with the simplicity your work deserves.",
    accounts: "Your accounts",
    noAccounts: "Your space starts with a connection.",
    first: "Connect your first account and bring your files closer.",
    streaming: "Stream files",
    streamingText:
      "Access files through a virtual drive. Files download when you need them.",
    mirror: "Mirror files",
    mirrorText:
      "In development · two-way sync with recovery and conflict resolution.",
    connected: "connected accounts",
    mounted: "active drives",
    attention: "need attention",
    quick: "Everything within reach",
    foldersTitle: "Keep important things close.",
    foldersText:
      "Pin folders while browsing. Their original names appear here.",
    safe: "Your work deserves care.",
    safeText:
      "Provider sign-in. Encrypted credential vault. Your files stay in your clouds.",
    open: "Open drive",
    mount: "Enable streaming",
    noActivity: "Upcoming activity appears here.",
    empty: "No files in this folder.",
    name: "Name",
    size: "Size",
    modified: "Modified",
    state: "Status",
    unknown: "Not verified",
    presence: "Other editors: presence unknown",
    updated: "No pending transfers",
    syncing: "Syncing",
    problem: "Problem",
    ready: "Ready to connect",
    missing: "The installation needs repair",
    language: "Language",
    startup: "Start at login",
    save: "Save preferences",
    accountName: "What would you like to call this account?",
    accountPlaceholder: "e.g. Google · Work",
    provider: "Choose your provider",
    continue: "Continue",
    login: "Secure connection",
    browser:
      "Authorization takes place in your provider’s browser. GCP-Drive never asks for your password.",
    answer: "Your answer",
    done: "Account connected. You can now browse your files.",
    cancel: "Close",
    localTitle: "Your folders belong here too.",
    localText:
      "Folder selection and automatic two-way sync are in development. This version supports streaming connected accounts.",
    preview: "DEVELOPMENT PREVIEW",
    hub: "YOUR MULTICLOUD WORKSPACE",
    welcome: "Make room for your best work.",
    plans: "Automatically mount when the app opens",
    actual: "Status based on engine observations",
    pinned: "Pinned folders",
    loading: "Checking your cloud…",
    secureLogin: "Authorize in browser",
    pending: "Preparing connection…",
    engineNote:
      "GCP-Drive includes its file engine and checks virtual-drive support. No separate tools need configuration.",
    back: "Back",
    root: "Root",
    work: "Gestão Cultural Pro",
    footer: "Made to keep your work flowing.",
    favoritesEmpty: "No pinned folders yet.",
    betaNote:
      "Initial version. Real-account and Linux/macOS validation pending.",
  },
  es: {
    home: "Vista general",
    files: "Mis archivos",
    favorites: "Favoritos",
    activity: "Actividad",
    folders: "Carpetas del equipo",
    settings: "Preferencias",
    connect: "Conectar cuenta",
    search: "Buscar en esta carpeta",
    indexed: "Buscar en el índice local",
    coverage:
      "Cobertura: solo carpetas visitadas. Hasta 100 resultados; los metadatos pueden estar desactualizados.",
    title: "Todas tus nubes.",
    subtitle: "Un lugar para crear.",
    intro:
      "Tus archivos, cuentas e ideas. Conectados a tu equipo con la sencillez que tu trabajo merece.",
    accounts: "Tus cuentas",
    noAccounts: "Tu espacio empieza con una conexión.",
    first: "Conecta tu primera cuenta y acerca tus archivos.",
    streaming: "Archivos por streaming",
    streamingText:
      "Accede mediante una unidad virtual. Los archivos se descargan cuando los necesitas.",
    mirror: "Duplicación de archivos",
    mirrorText:
      "En desarrollo · sincronización bidireccional con recuperación y resolución de conflictos.",
    connected: "cuentas conectadas",
    mounted: "unidades activas",
    attention: "requieren atención",
    quick: "Todo a tu alcance",
    foldersTitle: "Lo importante, siempre cerca.",
    foldersText:
      "Fija carpetas al explorar. Aquí aparecen con sus nombres reales.",
    safe: "Tu trabajo merece cuidado.",
    safeText:
      "Acceso con el proveedor. Credenciales cifradas. Tus archivos siguen en tus nubes.",
    open: "Abrir unidad",
    mount: "Activar streaming",
    noActivity: "Las próximas actividades aparecerán aquí.",
    empty: "No hay archivos en esta carpeta.",
    name: "Nombre",
    size: "Tamaño",
    modified: "Modificado",
    state: "Estado",
    unknown: "Sin verificar",
    presence: "Otros editores: presencia desconocida",
    updated: "Sin transferencias pendientes",
    syncing: "Sincronizando",
    problem: "Problema",
    ready: "Listo para conectar",
    missing: "La instalación necesita reparación",
    language: "Idioma",
    startup: "Iniciar con el sistema",
    save: "Guardar preferencias",
    accountName: "¿Cómo quieres llamar a esta cuenta?",
    accountPlaceholder: "Ej.: Google · Trabajo",
    provider: "Elige tu proveedor",
    continue: "Continuar",
    login: "Conexión segura",
    browser:
      "La autorización ocurre en el navegador de tu proveedor. GCP-Drive no solicita tu contraseña.",
    answer: "Tu respuesta",
    done: "Cuenta conectada. Ya puedes explorar tus archivos.",
    cancel: "Cerrar",
    localTitle: "Tus carpetas también cuentan.",
    localText:
      "La selección de carpetas y la sincronización bidireccional automática están en desarrollo. Esta versión ofrece streaming de las cuentas conectadas.",
    preview: "VISTA PREVIA DE DESARROLLO",
    hub: "TU ESPACIO MULTINUBE",
    welcome: "Dale espacio a tu mejor trabajo.",
    plans: "Montar automáticamente al abrir la aplicación",
    actual: "Estados basados en observaciones del motor",
    pinned: "Carpetas fijadas",
    loading: "Consultando tu nube…",
    secureLogin: "Autorizar en el navegador",
    pending: "Preparando la conexión…",
    engineNote:
      "GCP-Drive incluye su motor de archivos y comprueba el soporte de unidades virtuales. No necesitas configurar herramientas separadas.",
    back: "Volver",
    root: "Raíz",
    work: "Gestão Cultural Pro",
    footer: "Hecho para que tu trabajo fluya.",
    favoritesEmpty: "Todavía no hay carpetas fijadas.",
    betaNote:
      "Versión inicial. Validación con cuentas reales y Linux/macOS pendiente.",
  },
};
function ProviderMark({ type }: { type: Provider }) {
  return (
    <span className={`provider-mark ${type}`}>
      {type === "drive" ? (
        <svg viewBox="0 0 32 32">
          <path fill="#16a765" d="m11 3 8 0 10 18-8 0Z" />
          <path fill="#ffcc40" d="m11 3 5 9-10 18-5-9Z" />
          <path fill="#4285f4" d="m6 30 5-9h18l-5 9Z" />
        </svg>
      ) : type === "onedrive" ? (
        <Cloud fill="currentColor" size={28} />
      ) : type==='mega'||type==='protondrive'?<span className={'provider-monogram '+type} title={providers[type].name}>{type==='mega'?'M':'P'}</span> : (
        <svg viewBox="0 0 32 32" fill="currentColor">
          <path d="m9 3 7 5-7 5-7-5Zm14 0 7 5-7 5-7-5ZM9 14l7 5-7 5-7-5Zm14 0 7 5-7 5-7-5Zm-14 12 7-5 7 5-7 5Z" />
        </svg>
      )}
    </span>
  );
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState("home");
  const [notifications,setNotifications]=useState(false);
  const [storage,setStorage]=useState<{cacheBytes:number;cacheFiles:number;canClear:boolean;offlineBytes:number}>();
  const [licenses,setLicenses]=useState('');
  const [accountNames,setAccountNames]=useState<Record<string,string>>({});
  const [layout,setLayout]=useState('details');
  const [sort,setSort]=useState('name');
  const [pageNumber,setPageNumber]=useState(0);
  const [descending,setDescending]=useState(false);
  const [full,setFull]=useState(false);
  const [selected,setSelected]=useState<Entry>();
  const [newName,setNewName]=useState('');
  const [renaming,setRenaming]=useState(false);
  const [tabs,setTabs]=useState<{id:string;accountId:string;path:string}[]>([]);
  const [tab,setTab]=useState('');
  const [lang, setLang] = useState<Language>("pt-BR");
  const [startup, setStartup] = useState(false);
  const [error, setError] = useState("");
  const [authError,setAuthError]=useState('');
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [folder, setFolder] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  /** Last listing per folder: shown at once while the drive revalidates it. */
  const listings = useRef(new Map<string, Entry[]>());
  const [search, setSearch] = useState("");
  const [folderAccount, setFolderAccount] = useState("");
  const [folderDestination, setFolderDestination] = useState("");
  const [folderPreview, setFolderPreview] = useState<FolderPreview>();
  const [hits, setHits] = useState<SearchHitView[] | null>(null);
  const [modal, setModal] = useState(false);
  const [kind, setKind] = useState<Provider>("drive");
  const [label, setLabel] = useState("");
  const [loginUser,setLoginUser]=useState('');
  const [loginPassword,setLoginPassword]=useState('');
  const [loginOtp,setLoginOtp]=useState('');
  const [loginMailbox,setLoginMailbox]=useState('');
  const [supportCopied,setSupportCopied]=useState(false);
  const [session, setSession] = useState<{
    accountId: string;
    question: Question;
  }>();
  const [answer, setAnswer] = useState("");
  const [finished, setFinished] = useState(false);
  const request = useRef(0);
  const authGeneration = useRef(0);
  const [cancelling, setCancelling] = useState(false);
  const controls = {
    "pt-BR": {
      disconnect: "Desconectar conta",
      support: "Instalar suporte a unidades virtuais",
      cancel: "Cancelar conexão",
      exit: "Sair do GCP-Drive",
      workspace: "ÁREA DE TRABALHO",
    },
    en: {
      disconnect: "Disconnect account",
      support: "Install virtual drive support",
      cancel: "Cancel connection",
      exit: "Quit GCP-Drive",
      workspace: "WORKSPACE",
    },
    es: {
      disconnect: "Desconectar cuenta",
      support: "Instalar soporte de unidades virtuales",
      cancel: "Cancelar conexión",
      exit: "Salir de GCP-Drive",
      workspace: "ÁREA DE TRABAJO",
    },
  }[lang];
  const t = words[lang];
  const syncText = {
    "pt-BR": {
      description:
        "Escolha uma pasta do computador e seu destino. As alterações serão sincronizadas nos dois sentidos enquanto o aplicativo estiver aberto.",
      destination: "Pasta de destino na nuvem",
      choose: "Escolher pasta do computador",
      preview: "Ver prévia",
      enable: "Ativar sincronização automática",
      pause: "Pausar após a operação atual",
      initial:
        "Na primeira sincronização, a versão mais recente prevalece. Arquivos substituídos ficam no histórico. Conflitos posteriores preservam ambas as versões.",
      local: "Arquivos locais",
      cloud: "Arquivos na nuvem",
      common: "Nomes presentes nos dois lados",
      history: "Histórico de versões",
      noAccount: "Conecte uma conta antes de adicionar pastas.",
      phase: {
        paused: "Pausada",
        previewing: "Preparando prévia",
        ready: "Prévia pronta",
        syncing: "Sincronizando",
        idle: "Atualizada",
        error: "Requer atenção",
      },
    },
    en: {
      description:
        "Choose a computer folder and its cloud destination. Changes sync in both directions while the app is running.",
      destination: "Cloud destination folder",
      choose: "Choose computer folder",
      preview: "Preview",
      enable: "Enable automatic sync",
      pause: "Pause after current operation",
      initial:
        "During initial sync the newer version wins. Replaced files are retained in history. Later conflicts preserve both versions.",
      local: "Local files",
      cloud: "Cloud files",
      common: "Names on both sides",
      history: "Version history",
      noAccount: "Connect an account before adding folders.",
      phase: {
        paused: "Paused",
        previewing: "Preparing preview",
        ready: "Preview ready",
        syncing: "Syncing",
        idle: "Up to date",
        error: "Needs attention",
      },
    },
    es: {
      description:
        "Elige una carpeta del equipo y su destino en la nube. Los cambios se sincronizan en ambos sentidos mientras la aplicación está abierta.",
      destination: "Carpeta de destino en la nube",
      choose: "Elegir carpeta del equipo",
      preview: "Ver vista previa",
      enable: "Activar sincronización automática",
      pause: "Pausar después de la operación actual",
      initial:
        "En la sincronización inicial prevalece la versión más reciente. Los archivos reemplazados se conservan en el historial. Los conflictos posteriores preservan ambas versiones.",
      local: "Archivos locales",
      cloud: "Archivos en la nube",
      common: "Nombres presentes en ambos lados",
      history: "Historial de versiones",
      noAccount: "Conecta una cuenta antes de añadir carpetas.",
      phase: {
        paused: "Pausada",
        previewing: "Preparando vista previa",
        ready: "Vista previa lista",
        syncing: "Sincronizando",
        idle: "Actualizada",
        error: "Requiere atención",
      },
    },
  }[lang];
  async function call<K extends keyof Operations>(
    op: K,
    input: Operations[K]["input"],
  ): Promise<Operations[K]["output"]> {
    const result = await window.gcpDrive.call(op, input);
    if (!result.ok) throw new UserError(result.error);
    return result.value;
  }
  async function refresh() {
    const s = await call("snapshot", null);
    setSnapshot(s);
    return s;
  }
  useEffect(() => {
    void refresh()
      .then((s) => {
        setLang(s.preferences.language);
        setStartup(s.preferences.startAtLogin);
      })
      .catch((e) => setError(userMessage(e)));
    // A hidden window (tray) does not need snapshots; the engine keeps observing in the main process.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    }, 2500);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(()=>window.gcpDrive.onView(view=>setView(view)),[]);
  useEffect(()=>window.gcpDrive.onLocation(location=>void browse(location.accountId,location.path)),[]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(()=>{
    const apply=()=>{const selected=snapshot?.preferences.theme??'lavanda';const themes=[...builtinThemes,...(snapshot?.preferences.customThemes??[])];const theme=themes.find(t=>t.id===(selected==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'ametista':'lavanda'):selected))??builtinThemes[0];for(const [name,color]of Object.entries(theme.colors))document.documentElement.style.setProperty('--theme-'+name,color);document.documentElement.dataset.theme=theme.mode;};
    apply();const media=matchMedia('(prefers-color-scheme: dark)');media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
  },[snapshot?.preferences.theme,snapshot?.preferences.customThemes]);
  async function action(work: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? userMessage(e) : "Erro");
    } finally {
      setBusy(false);
    }
  }
  async function authAction(work:()=>Promise<unknown>){
    setAuthError('');setBusy(true);
    try{await work();await refresh();}catch(error){setAuthError(userMessage(error));authGeneration.current++;setSession(undefined);setFinished(false);try{await call('cancelLogin',null);}catch{}await refresh().catch(()=>{});}finally{setBusy(false);}
  }
  async function browse(id: string, remote = "",newTab=false) {
    setPageNumber(0);
    setSelected(undefined);setRenaming(false);
    const key=newTab||!tab?crypto.randomUUID():tab;
    setTab(key);
    setTabs(previous=>newTab||!tab?[...previous,{id:key,accountId:id,path:remote}]:previous.map(t=>t.id===key?{...t,accountId:id,path:remote}:t));
    setHits(null);
    const serial = ++request.current;
    setAccount(id);
    setFolder(remote);
    setView("files");
    setSearch("");
    await load(serial, id, remote);
  }
  async function load(serial: number, id: string, remote: string) {
    const key = id + "\0" + remote;
    setEntries(listings.current.get(key) ?? []);
    setLoading(true);
    try {
      const files = await call("list", { accountId: id, path: remote });
      listings.current.delete(key);
      listings.current.set(key, files);
      if (listings.current.size > 40) listings.current.delete(listings.current.keys().next().value!);
      if (serial === request.current) setEntries(files);
    } catch (e) {
      if (serial === request.current) setError(userMessage(e));
    } finally {
      if (serial === request.current) setLoading(false);
    }
  }
  async function activateTab(item:{id:string;accountId:string;path:string}) {
    const serial=++request.current;setAccount(item.accountId);setFolder(item.path);setSelected(undefined);setHits(null);setSearch('');
    await load(serial,item.accountId,item.path);
  }
  function selectedPath(){return folder?folder+'/'+selected!.Path:selected!.Path;}
  // Rows read status and formatting several times per render; resolve each once per snapshot.
  // Transfers observed now take precedence over the cache state the listing carried.
  const statusOf=useMemo(()=>{const seen=new Map<string,string>();return(entry:Entry)=>{let value=seen.get(entry.Path);if(value===undefined){value=itemStatus(entry);if(value==='unknown')value=entry.IsDir?'folder':entry.State??'unknown';seen.set(entry.Path,value);}return value;};},[snapshot,account,folder]);
  const stateLabels:Record<string,[string,string]>={problem:['red',t.problem],complete:['green','Transferência concluída'],transferring:['orange',t.syncing],queued:['orange','Aguardando envio'],pending:['orange','Alteração aguardando envio'],local:['green','Disponível neste computador'],partial:['gray','Parcialmente baixado'],cloud:['gray','Somente na nuvem'],folder:['none','Pasta'],unknown:['gray',t.unknown]};
  const dateFormat=useMemo(()=>new Intl.DateTimeFormat(lang),[lang]);
  const sizeFormat=useMemo(()=>{const number=new Intl.NumberFormat(lang,{maximumFractionDigits:1});const units=['B','KB','MB','GB','TB'];return(bytes:number)=>{let value=bytes,unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return number.format(value)+' '+units[unit];};},[lang]);
  function itemStatus(entry:Entry){const remote=folder?folder+'/'+entry.Path:entry.Path;const transfers=snapshot?.mounts.find(m=>m.accountId===account)?.transfers;return transfers?.find(t=>t.path===remote||(entry.IsDir&&t.phase!=='complete'&&t.path.startsWith(remote+'/')))?.phase??'unknown';}
  const displayedEntries=useMemo(()=>entries.filter(e=>e.Name.toLocaleLowerCase(lang).includes(search.toLocaleLowerCase(lang))).sort((a,b)=>(descending?-1:1)*(sort==='size'?a.Size-b.Size:sort==='modified'?Date.parse(a.ModTime)-Date.parse(b.ModTime):sort==='type'?Number(b.IsDir)-Number(a.IsDir)||a.Name.split('.').at(-1)!.localeCompare(b.Name.split('.').at(-1)!,lang):sort==='state'?statusOf(a).localeCompare(statusOf(b)):a.Name.localeCompare(b.Name,lang,{numeric:true}))),[entries,search,sort,descending,lang,sort==='state'?statusOf:undefined]);
  const pageCount=Math.max(1,Math.ceil(displayedEntries.length/200));
  const actualPage=Math.min(pageNumber,pageCount-1);
  const current = snapshot?.preferences.accounts.find((a) => a.id === account);
  const mounts = snapshot?.mounts || [];
  const active = mounts.filter((m) => m.phase === "running").length;
  const problems = mounts.filter((m) => m.phase === "error").length;
  function connect() {
    setError('');setAuthError('');
    if (cancelling) return;
    authGeneration.current++;
    setModal(true);
    setSession(undefined);
    setFinished(false);
    setLabel("");
    setAnswer("");
    setLoginUser('');setLoginPassword('');setLoginOtp('');setLoginMailbox('');
  }
  async function cancelConnection() {
    setAuthError('');
    setLoginUser('');setLoginPassword('');setLoginOtp('');setLoginMailbox('');
    authGeneration.current++;
    setCancelling(true);
    setModal(false);
    setSession(undefined);
    setFinished(false);
    setBusy(false);
    setError("");
    try {
      await call("cancelLogin", null);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? userMessage(e) : "Não foi possível cancelar a conexão.",
      );
    } finally {
      setCancelling(false);
    }
  }
  function stat(id: string) {
    const m = mounts.find((x) => x.accountId === id);
    return m?.phase === "error" || m?.sync === "problem"
      ? "red"
      : m?.phase === "starting" || m?.sync === "transferring"
        ? "orange"
        : m?.sync === "idle"
          ? "green"
          : "gray";
  }
  return (
    <div className={"app "+(full?"files-fullscreen":"")}>
      <aside>
        <div className="brand">
          <img className="brand-icon" src="../assets/icon.png" alt="GCP-Drive"/>
          <div>
            GCP<span> / </span>Drive<small>GESTÃO CULTURAL PRO</small>
          </div>
        </div>
        <button className="connect primary" onClick={connect}>
          <Plus size={18} />
          {t.connect}
        </button>
        <div className="nav-label">{controls.workspace}</div>
        <nav>
          {(
            [
              ["home", House, t.home],
              ["accounts", HardDrive, "Contas e armazenamento"],
              ["files", Folder, t.files],
              ["favorites", Star, t.favorites],
              ["activity", Activity, t.activity],
              ["folders", Monitor, t.folders],
            ] as const
          ).map(([key, Icon, text]) => (
            <button
              className={view === key ? "selected" : ""}
              aria-current={view === key ? "page" : undefined}
              key={key}
              onClick={() => setView(key)}
            >
              <Icon size={19} />
              {text}
              {key === "favorites" &&
                !!snapshot?.preferences.favorites.length && (
                  <small>{snapshot.preferences.favorites.length}</small>
                )}
            </button>
          ))}
        </nav>
        <div className="nav-label accounts-label">
          {t.accounts}
          <button aria-label={t.connect} onClick={connect}>
            <Plus size={15} />
          </button>
        </div>
        <div className="side-accounts">
          {snapshot?.preferences.accounts.map((a) => (
            <button key={a.id} onClick={() => void browse(a.id)}>
              <ProviderMark type={a.provider} />
              <span>{a.label}</span>
              <i className={`dot ${stat(a.id)}`} />
            </button>
          ))}
          {!snapshot?.preferences.accounts.length && (
            <span className="side-empty">
              Google Drive · OneDrive · Dropbox · MEGA · Proton Drive
            </span>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="privacy">
            <ShieldCheck size={18} />
            <div>
              {t.work}
              <small>{t.footer}</small>
            </div>
          </div>
          <button
            className={view === "settings" ? "selected" : ""}
            onClick={() => setView("settings")}
          >
            <Settings size={18} />
            {t.settings}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div className="breadcrumb">
            {t.work}
            <ChevronRight size={14} />
            <strong>
              {view === 'accounts' ? 'Contas e armazenamento' : view === "home"
                ? t.home
                : view === "files"
                  ? t.files
                  : view === "favorites"
                    ? t.favorites
                    : view === "activity"
                      ? t.activity
                      : view === "folders"
                        ? t.folders
                        : t.settings}
            </strong>
          </div>
          <div className="header-right">
            <span className="preview">{t.preview}</span>
            <button
              className="icon-button"
              onClick={() => setNotifications(value=>!value)}
              aria-label="Notificações"
            >
              <Bell size={18} />
              {problems > 0 && <b />}
            </button>
            <button className="avatar" aria-label="Contas e armazenamento" onClick={()=>setView('accounts')}>{current?.label.slice(0,2).toUpperCase()??'GC'}</button>
          </div>
        </header>
        <main>
          {notifications&&<section className="panel notification-panel"><div className="section-heading"><h2>Notificações</h2><button onClick={()=>setNotifications(false)} aria-label="Fechar notificações"><X/></button></div>{snapshot?.activity.filter(a=>a.level==='error').length?snapshot.activity.filter(a=>a.level==='error').map((a,i)=><p key={i}>{a.message} · {new Date(a.at).toLocaleString(lang)}</p>):<p>Tudo em dia. Nenhum problema informado.</p>}<button className="text-button" onClick={()=>{setView('activity');setNotifications(false);}}>Ver todas as atividades</button></section>}
          {view==='accounts'&&<><div className="page-title"><div><span className="eyebrow">Suas nuvens</span><h1>Contas e armazenamento</h1><p>Consulte suas contas e o espaço utilizado neste computador.</p></div></div><section className="panel account-manager" aria-label="Gerenciar contas e armazenamento">{snapshot?.preferences.accounts.map(a=><div className="setting-row" key={a.id}><button onClick={()=>{void browse(a.id);setStorage(undefined);}}><ProviderMark type={a.provider}/><strong>{a.label}</strong><span className={'dot '+stat(a.id)}/></button><button className="secondary" aria-label={'Ver armazenamento de '+a.label} disabled={busy} onClick={()=>void action(async()=>{const result=await call('storage',{accountId:a.id});setAccount(a.id);setStorage(result);})}>Armazenamento</button></div>)}{!snapshot?.preferences.accounts.length&&<div className="empty-state"><HardDrive size={40}/><h3>Nenhuma conta conectada</h3><p>Conecte uma conta para consultar seu armazenamento.</p><button className="primary" onClick={connect}><Plus size={17}/>Conectar conta</button></div>}{storage&&<div className="storage-summary"><h3>{current?.label}</h3><p>Cache: {formatBytes(storage.cacheBytes)} · {storage.cacheFiles} arquivos</p><p>Arquivos fixados off-line: {formatBytes(storage.offlineBytes)}</p><button className="secondary" disabled={busy||!storage.canClear} onClick={()=>void action(async()=>{await call('clearCache',{accountId:account});setStorage(await call('storage',{accountId:account}));})}>Limpar cache e liberar espaço</button></div>}</section></>}
          {!!snapshot?.preferences.accounts.length &&
            !snapshot.mountSupport.available && (
              <div className="mount-support">
                <HardDrive size={21} />
                <div>
                  <strong>
                    {lang === "pt-BR"
                      ? "A unidade ainda não está disponível no sistema"
                      : t.problem}
                  </strong>
                  <p>{snapshot.mountSupport.message}</p>
                </div>
                {snapshot.mountSupport.installURL && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void action(() => call("openMountSupport", null))
                    }
                  >
                    {controls.support}
                    <ExternalLink size={15} />
                  </button>
                )}
              </div>
            )}
          {error && (
            <div className="error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label={t.cancel}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "home" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">{t.hub}</span>
                  <h1>{t.welcome}</h1>
                </div>
                <span className="date">
                  {new Intl.DateTimeFormat(lang, {
                    day: "numeric",
                    month: "long",
                  }).format(new Date())}
                </span>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <div className="hero-tag">
                    <span /> GCP-DRIVE
                  </div>
                  <h2>
                    {t.title}
                    <br />
                    <em>{t.subtitle}</em>
                  </h2>
                  <p>{t.intro}</p>
                  <button onClick={connect}>
                    {t.connect}
                    <ArrowUpRight size={18} />
                  </button>
                  <div className="hero-providers">
                    <ProviderMark type="drive" />
                    <ProviderMark type="onedrive" />
                    <ProviderMark type="dropbox" />
                    <ProviderMark type="mega"/><ProviderMark type="protondrive"/>
                    <span>Google Drive, OneDrive, Dropbox, MEGA e Proton Drive</span>
                  </div>
                </div>
                <div className="cloud-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="cloud-tile">
                    <Cloud size={94} strokeWidth={1.3} />
                    <span>
                      <Check size={20} />
                    </span>
                  </div>
                  <div className="float-provider fp-google">
                    <ProviderMark type="drive" />
                  </div>
                  <div className="float-provider fp-one">
                    <ProviderMark type="onedrive" />
                  </div>
                  <div className="float-provider fp-drop">
                    <ProviderMark type="dropbox" />
                  </div>
                  <div className="art-label">
                    <ShieldCheck size={14} /> SEU ESPAÇO. SUAS POSSIBILIDADES.
                  </div>
                </div>
              </section>
              <div className="stats">
                <div>
                  <span className="stat-icon purple">
                    <Cloud size={20} />
                  </span>
                  <strong>{snapshot?.preferences.accounts.length || 0}</strong>
                  <span>{t.connected}</span>
                </div>
                <div>
                  <span className="stat-icon mint">
                    <HardDrive size={20} />
                  </span>
                  <strong>{active}</strong>
                  <span>{t.mounted}</span>
                </div>
                <div>
                  <span className="stat-icon peach">
                    <Activity size={20} />
                  </span>
                  <strong>{problems}</strong>
                  <span>{t.attention}</span>
                </div>
              </div>
              <div className="section-heading">
                <h3>{t.accounts}</h3>
                <button className="text-button" onClick={connect}>
                  <Plus size={16} />
                  {t.connect}
                </button>
              </div>
              <div className="account-grid">
                {snapshot?.preferences.accounts.map((a) => (
                  <article className="account-card" key={a.id}>
                    <div className="account-top">
                      <ProviderMark type={a.provider} />
                      <span className={`status ${stat(a.id)}`}>
                        <i className={`dot ${stat(a.id)}`} />
                        {stat(a.id) === "red"
                          ? t.problem
                          : stat(a.id) === "orange"
                            ? t.syncing
                            : stat(a.id) === "green"
                              ? t.updated
                              : t.unknown}
                      </span>
                    </div>
                    <h4>{a.label}</h4>
                    <p>
                      {a.provider === "drive"
                        ? "Google Drive"
                        : a.provider === "onedrive"
                          ? "Microsoft OneDrive"
                          : "Dropbox"}
                    </p>
                    <div className="account-actions">
                      <button onClick={() => void browse(a.id)}>
                        {t.files}
                        <ArrowRight size={15} />
                      </button>
                      <button
                        disabled={
                          busy ||
                          mounts.some(
                            (m) => m.accountId === a.id && m.phase !== "error",
                          )
                        }
                        onClick={() =>
                          void action(() => call("mount", { accountId: a.id }))
                        }
                      >
                        {t.mount}
                      </button>
                    </div>
                    {mounts.find((m) => m.accountId === a.id)?.phase ===
                      "running" && (
                      <button
                        className="open-unit"
                        onClick={() =>
                          void action(() =>
                            call("open", { accountId: a.id, path: "" }),
                          )
                        }
                      >
                        <ExternalLink size={14} />
                        {t.open}
                      </button>
                    )}
                    {mounts.find((m) => m.accountId === a.id)?.message && (
                      <p className="mount-message">
                        {mounts.find((m) => m.accountId === a.id)?.message}
                      </p>
                    )}
                    <button
                      className="disconnect-button"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          call("disconnect", { accountId: a.id }),
                        )
                      }
                    >
                      <X size={13} />
                      {controls.disconnect}
                    </button>
                  </article>
                ))}
                {!snapshot?.preferences.accounts.length && (
                  <button className="empty-account" onClick={connect}>
                    <span className="empty-plus">
                      <Plus size={23} />
                    </span>
                    <strong>{t.noAccounts}</strong>
                    <span>{t.first}</span>
                    <ArrowUpRight size={20} />
                  </button>
                )}
              </div>
              <div className="bottom-grid">
                <section className="panel favorites-panel">
                  <div className="section-heading">
                    <h3>
                      <Star size={17} />
                      {t.pinned}
                    </h3>
                    <ArrowUpRight size={17} />
                  </div>
                  {snapshot?.preferences.favorites.length ? (
                    snapshot.preferences.favorites.slice(0, 4).map((f) => (
                      <button
                        className="favorite-row"
                        key={f.accountId + f.path}
                        onClick={() => void browse(f.accountId, f.path)}
                      >
                        <Folder size={20} />
                        {f.name}
                        <ChevronRight size={16} />
                      </button>
                    ))
                  ) : (
                    <>
                      <div className="folder-art">
                        <Folder size={38} />
                        <Star size={17} />
                      </div>
                      <h4>{t.foldersTitle}</h4>
                      <p>{t.foldersText}</p>
                    </>
                  )}
                </section>
                <section className="panel security-panel">
                  <span className="shield">
                    <ShieldCheck size={25} />
                  </span>
                  <h3>{t.safe}</h3>
                  <p>{t.safeText}</p>
                  <div>
                    <i
                      className={`dot ${snapshot?.engine.available ? "green" : "orange"}`}
                    />
                    {snapshot?.engine.available ? t.ready : t.missing}
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "files" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">{t.files}</span>
                  <h1>{current?.label || t.accounts}</h1>
                </div>
                {current && (
                  <button
                    className="secondary"
                    onClick={() =>
                      void action(() =>
                        call("open", { accountId: current.id, path: folder }),
                      )
                    }
                  >
                    <ExternalLink size={16} />
                    {t.open}
                  </button>
                )}
              </div>
              <div className="account-tabs">
                {snapshot?.preferences.accounts.map((a) => (
                  <button
                    key={a.id}
                    className={account === a.id ? "active" : ""}
                    onClick={() => void browse(a.id)}
                  >
                    <ProviderMark type={a.provider} />
                    {a.label}
                  </button>
                ))}
              </div>
              {!current ? (
                <div className="panel empty-state">
                  <Cloud size={46} />
                  <h3>{t.noAccounts}</h3>
                  <button className="primary" onClick={connect}>
                    {t.connect}
                  </button>
                </div>
              ) : (
                <section className={"panel file-panel layout-"+layout}>
                  <div className="browse-tabs" role="tablist">{tabs.map(item=><div key={item.id} className={tab===item.id?'active':''}><button role="tab" aria-selected={tab===item.id} onClick={()=>{setTab(item.id);void activateTab(item);}}>{item.path.split('/').at(-1)||snapshot?.preferences.accounts.find(a=>a.id===item.accountId)?.label}</button><button aria-label="Fechar aba" onClick={()=>{setTabs(previous=>previous.filter(t=>t.id!==item.id));if(tab===item.id)setTab('');}}><X size={13}/></button></div>)}<button title="Nova aba" onClick={()=>void browse(account,folder,true)}><Plus size={16}/></button></div>
                  <div className="view-toolbar"><label>Visualizar <select aria-label="Visualizar arquivos" value={layout} onChange={e=>setLayout(e.target.value)}><option value="details">Detalhes</option><option value="list">Lista</option><option value="gallery">Galeria</option></select></label><label>Classificar <select aria-label="Classificar arquivos" value={sort} onChange={e=>setSort(e.target.value)}><option value="name">Nome</option><option value="size">Tamanho</option><option value="modified">Modificado</option><option value="state">Estado</option><option value="type">Tipo</option></select></label><button className="secondary" onClick={()=>setDescending(v=>!v)}>{descending?'Decrescente':'Crescente'}</button><button className="secondary" onClick={()=>void action(async()=>{await call('fullscreen',null);setFull(v=>!v);})}>{full?'Sair da janela cheia':'Janela cheia'}</button></div>
                  {selected&&<div className="selection-toolbar"><FileIcon iconKey={selected.IconKey}/><strong>{selected.Name}</strong><button onClick={()=>selected.IsDir?void browse(account,selectedPath()):void action(()=>call('open',{accountId:account,path:selectedPath()}))}>Abrir</button>{selected.IsDir&&<button onClick={()=>void browse(account,selectedPath(),true)}>Abrir em nova aba</button>}<button onClick={()=>void action(()=>call('web',{accountId:account,path:selectedPath(),share:true}))}>Compartilhar no provedor</button><button onClick={()=>void action(()=>call('download',{accountId:account,path:selectedPath()}))}>Baixar</button><button onClick={()=>{setNewName(selected.Name);setRenaming(true);}}>Renomear</button><button onClick={()=>void action(()=>call('favorite',{accountId:account,path:selectedPath(),name:selected.Name}))}>Fixar / desafixar</button><button aria-label="Limpar seleção" onClick={()=>setSelected(undefined)}><X size={16}/></button></div>}
                  {renaming&&selected&&<form className="rename-form" onSubmit={e=>{e.preventDefault();void action(async()=>{await call('rename',{accountId:account,path:selectedPath(),name:newName});setRenaming(false);await browse(account,folder);});}}><label>Novo nome <input autoFocus value={newName} onChange={e=>setNewName(e.target.value)}/></label><button className="primary" disabled={busy}>Salvar nome</button><button type="button" onClick={()=>setRenaming(false)}>Cancelar</button></form>}
                  <div className="file-toolbar">
                    <button
                      className="icon-button"
                      disabled={!folder}
                      aria-label={t.back}
                      title={t.back}
                      onClick={() =>
                        void browse(
                          account,
                          folder.split("/").slice(0, -1).join("/"),
                        )
                      }
                    >
                      ↑
                    </button>
                    <nav className="breadcrumb" aria-label="Caminho">
                      <button onClick={() => void browse(account, "")}>{current.label}</button>
                      {folder && folder.split("/").map((part, index, parts) => (
                        <React.Fragment key={index}>
                          <ChevronRight size={12} />
                          <button
                            aria-current={index === parts.length - 1 ? "page" : undefined}
                            onClick={() => void browse(account, parts.slice(0, index + 1).join("/"))}
                          >
                            {part}
                          </button>
                        </React.Fragment>
                      ))}
                      {loading && entries.length > 0 && <small className="revalidating">Atualizando…</small>}
                    </nav>
                    <div className="file-search">
                      <Search size={16} />
                      <input
                        aria-label={t.search}
                        placeholder={t.search}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <button
                      disabled={busy || !search.trim()}
                      title={t.indexed}
                      onClick={() =>
                        void action(async () => {
                          const result = await call("search", {
                            accountId: account,
                            query: search,
                          });
                          setHits(result.hits);
                        })
                      }
                    >
                      <Search size={16} />
                      {t.indexed}
                    </button>
                    <button
                      aria-label={t.activity}
                      onClick={() => void action(async()=>{await call("refreshFolder",{accountId:account,path:folder});await browse(account,folder);})}
                    >
                      <RefreshCw size={17} />
                    </button>
                    {current.provider==='drive'&&(!folder||folder.startsWith('Drives compartilhados'))&&<button className="secondary" disabled={busy} title="Atualiza a lista de drives compartilhados; aguarda gravações e remonta a unidade" onClick={()=>void action(async()=>{await call('refreshShared',{accountId:account});await browse(account,'');})}>Atualizar drives compartilhados</button>}
                  </div>
                  {hits !== null && (
                    <section className="index-results">
                      <div className="section-heading">
                        <h3>{t.indexed}</h3>
                        <button
                          aria-label={t.cancel}
                          onClick={() => setHits(null)}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <p>{t.coverage}</p>
                      {hits.map((hit) => (
                        <button
                          className="favorite-row"
                          key={hit.path}
                          onClick={() => {
                            if (hit.isDir) void browse(account, hit.path);
                            else
                              void action(() =>
                                call("open", {
                                  accountId: account,
                                  path: hit.path,
                                }),
                              );
                          }}
                        >
                          <FileIcon iconKey={hit.IconKey}/>
                          <span>
                            {hit.name}
                            <small>{hit.path}</small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                      {!hits.length && <p>{t.empty}</p>}
                    </section>
                  )}
                  <table>
                    <thead>
                      <tr>
                        <th>{t.name}</th>
                        <th>{t.size}</th>
                        <th>{t.modified}</th>
                        <th>{t.state}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {displayedEntries.slice(actualPage*200,actualPage*200+200)
                        .map((e) => (
                          <tr
                            key={e.Path}
                            className={selected?.Path===e.Path?'selected':''}
                            onClick={()=>setSelected(e)}
                            onContextMenu={event=>{event.preventDefault();setSelected(e);}}
                            onDoubleClick={() => {
                              const remote = folder
                                ? `${folder}/${e.Path}`
                                : e.Path;
                              if (e.IsDir) void browse(account, remote);
                              else
                                void action(() =>
                                  call("open", {
                                    accountId: account,
                                    path: remote,
                                  }),
                                );
                            }}
                          >
                            <td>
                              <span className="file-name">
                                <FileIcon iconKey={e.IconKey??(e.IsDir?'folder':'file:')} size={layout==='gallery'?48:23}/>
                                <span>{e.Name}</span>
                              </span>
                            </td>
                            <td>
                              {e.IsDir ? "—" : sizeFormat(e.Size)}
                            </td>
                            <td>
                              {Number.isNaN(Date.parse(e.ModTime))
                                ? "—"
                                : dateFormat.format(new Date(e.ModTime))}
                            </td>
                            <td>
                              <span className="file-status" title={t.presence}>
                                <i className={'dot '+stateLabels[statusOf(e)][0]} />
                                {stateLabels[statusOf(e)][1]}
                              </span>
                            </td>
                            <td>
                              {e.IsDir && (
                                <button
                                  aria-label={t.favorites}
                                  onClick={() =>
                                    void action(() =>
                                      call("favorite", {
                                        accountId: account,
                                        path: folder
                                          ? `${folder}/${e.Path}`
                                          : e.Path,
                                        name: e.Name,
                                      }),
                                    )
                                  }
                                >
                                  <Star
                                    size={17}
                                    fill={
                                      snapshot?.preferences.favorites.some(
                                        (f) =>
                                          f.accountId === account &&
                                          f.path ===
                                            (folder
                                              ? `${folder}/${e.Path}`
                                              : e.Path),
                                      )
                                        ? "#b59a53"
                                        : "none"
                                    }
                                  />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {entries.length>0&&<div className="file-toolbar"><span>{displayedEntries.length} itens{pageCount>1&&` · página ${actualPage+1} de ${pageCount}`}</span>{pageCount>1&&<><button disabled={actualPage===0} onClick={()=>setPageNumber(actualPage-1)}>Anterior</button><button disabled={actualPage+1>=pageCount} onClick={()=>setPageNumber(actualPage+1)}>Próxima</button></>}</div>}
                  {!entries.length && (
                    <div className="empty-state">
                      {loading ? (
                        <RefreshCw className="spin" size={28} />
                      ) : (
                        <Folder size={36} />
                      )}
                      <p>{loading ? t.loading : t.empty}</p>
                      {loading && slow && <small>Pastas grandes podem levar alguns segundos na primeira abertura. Depois disso, o Explorador e o painel usam a mesma lista em cache.</small>}
                    </div>
                  )}
                  <div className="file-foot">
                    <Users size={15} />
                    {t.presence}
                  </div>
                </section>
              )}
            </>
          )}
          {view==='favorites'&&<FavoritesPanel snapshot={snapshot} language={lang} remove={favorite=>void action(()=>call('favorite',favorite))} open={favorite=>favorite.isDir===false?void action(()=>call('open',{accountId:favorite.accountId,path:favorite.path})):void browse(favorite.accountId,favorite.path)}/>}
          {view==='activity'&&<ActivityPanel snapshot={snapshot} language={lang} busy={busy} invoke={call} action={action}/>}
          {view === "folders" && (
            <>
              <div className="page-title">
                <div>
                  <span className="eyebrow">{t.mirror}</span>
                  <h1>{t.folders}</h1>
                </div>
              </div>
              <section className="panel folder-setup">
                <p>{syncText.description}</p>
                <div className="folder-form">
                  <select
                    aria-label={t.accounts}
                    value={folderAccount}
                    onChange={(e) => {
                      setFolderAccount(e.target.value);
                      const a = snapshot?.preferences.accounts.find(
                        (a) => a.id === e.target.value,
                      );
                      setFolderDestination(
                        a?.provider === "drive"
                          ? "Meu Drive/Computador"
                          : "Computador",
                      );
                    }}
                  >
                    <option value="">{t.accounts}</option>
                    {snapshot?.preferences.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={syncText.destination}
                    value={folderDestination}
                    onChange={(e) => setFolderDestination(e.target.value)}
                    placeholder={syncText.destination}
                  />
                  <button
                    className="primary"
                    disabled={
                      busy || !folderAccount || !folderDestination.trim()
                    }
                    onClick={() =>
                      void action(() =>
                        call("addFolder", {
                          accountId: folderAccount,
                          remotePath: folderDestination,
                        }),
                      )
                    }
                  >
                    <Plus size={17} />
                    {syncText.choose}
                  </button>
                </div>
                <p className="beta-note">{syncText.initial}</p>
                {!snapshot?.preferences.accounts.length && (
                  <button className="text-button" onClick={connect}>
                    {syncText.noAccount}
                  </button>
                )}
              </section>
              {snapshot?.preferences.folderPlans?.map((p) => {
                const state = snapshot.folderSyncs.find((s) => s.id === p.id);
                const phase = state?.phase ?? "paused";
                return (
                  <section className="panel sync-plan" key={p.id}>
                    <div className="section-heading">
                      <h3>
                        <FolderSync size={20} />
                        {p.localPath.split(/[\\/]/).at(-1)}
                      </h3>
                      <span className="file-status">
                        <i
                          className={`dot ${phase === "syncing" ? "orange" : phase === "error" ? "red" : phase === "idle" ? "green" : "gray"}`}
                        />
                        {syncText.phase[phase]}
                      </span>
                    </div>
                    <p className="sync-path">
                      {p.localPath}
                      <br />
                      <span>
                        ↔{" "}
                        {
                          snapshot.preferences.accounts.find(
                            (a) => a.id === p.accountId,
                          )?.label
                        }{" "}
                        / {p.remotePath}
                      </span>
                    </p>
                    {state?.message && (
                      <div className="error">{state.message}</div>
                    )}
                    <div className="sync-actions"><button className="secondary" disabled={busy||phase==='previewing'} onClick={()=>void action(()=>call('removeFolder',{planId:p.id}))}>Parar e remover sincronização</button>
                      {!p.enabled && (
                        <button
                          className="secondary"
                          disabled={busy || phase === "syncing"}
                          onClick={() =>
                            void action(async () =>
                              setFolderPreview(
                                await call("previewFolder", { planId: p.id }),
                              ),
                            )
                          }
                        >
                          {syncText.preview}
                        </button>
                      )}
                      <button
                        className={p.enabled ? "secondary" : "primary"}
                        disabled={
                          busy ||
                          phase === "previewing" ||
                          (!p.enabled && !p.initialized && phase !== "ready")
                        }
                        onClick={() =>
                          void action(() =>
                            call(p.enabled ? "pauseFolder" : "startFolder", {
                              planId: p.id,
                            }),
                          )
                        }
                      >
                        {p.enabled ? syncText.pause : syncText.enable}
                      </button>
                    </div>
                    {folderPreview?.planId === p.id && (
                      <div className="sync-preview">
                        <div>
                          <strong>{folderPreview.localFiles}</strong>
                          {syncText.local}
                        </div>
                        <div>
                          <strong>{folderPreview.cloudFiles}</strong>
                          {syncText.cloud}
                        </div>
                        <div>
                          <strong>{folderPreview.sameNames}</strong>
                          {syncText.common}
                        </div>
                        <p>
                          {syncText.history}:<br />
                          {folderPreview.historyLocal}
                          <br />
                          {folderPreview.historyRemote}
                        </p>
                        <p>{syncText.initial}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </>
          )}
          {view === "settings" && (
            <>
              <div className="page-title">
                <h1>{t.settings}</h1>
              </div>
              <section className="panel settings-panel">
                <UpdatesPanel snapshot={snapshot} busy={busy} language={lang} invoke={call} action={action}/><hr/>
                <h3>Aparência</h3><div className="theme-grid">{[...builtinThemes,...(snapshot?.preferences.customThemes??[])].map(theme=><button className={(snapshot?.preferences.theme??'lavanda')===theme.id?'selected':''} key={theme.id} onClick={()=>void action(()=>call('appearance',{theme:theme.id}))}><span className="theme-preview" style={{background:theme.colors.background,borderColor:theme.colors.accent}}><span style={{background:theme.colors.accent}}/><span style={{background:theme.colors.surface}}/></span><strong>{theme.name}</strong></button>)}</div><div className="theme-controls"><button className="secondary" onClick={()=>void action(()=>call('appearance',{theme:'system'}))}>Acompanhar o tema do sistema</button><button className="secondary" onClick={()=>void action(()=>call('installTheme',null))}>Instalar tema por arquivo</button></div><hr/>
                <div className="setting-row">
                  <div>
                    <Globe size={19} />
                    <strong>{t.language}</strong>
                  </div>
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as Language)}
                  >
                    <option value="pt-BR">Português (Brasil)</option>
                    <option value="en">English</option>
                    <option value="es">Español</option>
                  </select>
                </div>
                <div className="setting-row">
                  <div>
                    <Monitor size={19} />
                    <strong>{t.startup}</strong>
                  </div>
                  <input
                    type="checkbox"
                    checked={startup}
                    onChange={(e) => setStartup(e.target.checked)}
                  />
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      call("preferences", {
                        language: lang,
                        startAtLogin: startup,
                      }),
                    )
                  }
                >
                  {t.save}
                  <Check size={17} />
                </button>
                <hr />
                <div className="setting-row"><strong>GCP-Drive {snapshot?.version}</strong><button className="secondary" onClick={()=>void action(async()=>setLicenses(await call('licenses',null)))}>Sobre e licenças</button></div>
                <p>{t.engineNote}</p>
                <p className="beta-note">{t.betaNote}</p>
                <hr />
                <h3>{t.accounts}</h3>
                {snapshot?.preferences.accounts.map((a) => (
                  <div className="setting-row" key={a.id}>
                    <div>
                      <ProviderMark type={a.provider} />
                      <strong>{a.label}</strong>
                      <span className="muted">{a.mountLetter ?? ""}</span>
                    </div>
                    <form className="rename-account" onSubmit={event=>{event.preventDefault();void action(()=>call('renameAccount',{accountId:a.id,label:accountNames[a.id]??a.label}));}}><input aria-label={'Nome da conta '+a.label} maxLength={64} value={accountNames[a.id]??a.label} onChange={event=>setAccountNames({...accountNames,[a.id]:event.target.value})}/><button className="secondary" disabled={busy}>Salvar nome</button></form>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(() =>
                          call("disconnect", { accountId: a.id }),
                        )
                      }
                    >
                      {controls.disconnect}
                    </button>
                  </div>
                ))}
                <hr />
                <button
                  className="secondary"
                  onClick={() => void call("quit", null)}
                >
                  {controls.exit}
                </button>
              </section>
            </>
          )}
        </main>
        {licenses&&<div className="modal-backdrop"><section className="modal license-modal"><button className="close" aria-label="Fechar licenças" onClick={()=>setLicenses('')}><X/></button><h2>GCP-Drive {snapshot?.version}</h2><p>Desenvolvido por Bruno Albertini | <button className="text-button" onClick={()=>void call('support',{action:'website'})}>Gestão Cultural Pro ↗</button></p><h3 className="support-title"><span aria-hidden="true">❤️</span> Apoie o projeto</h3><p>Sua contribuição ajuda a manter o GCP-Drive em evolução.</p><div className="support-grid"><section><h3>PIX · Brasil</h3><img className="pix-qr" src="../assets/pix-qr.svg" alt="QR Code PIX para apoiar Bruno Albertini"/><p>Escaneie com o aplicativo do seu banco.</p><button className="primary" onClick={()=>void action(async()=>{await call('support',{action:'pix'});setSupportCopied(true);})}>{supportCopied?'PIX copiado':'Copiar PIX'}</button><details><summary>Ver código PIX</summary><code>{PIX}</code></details></section><section><h3>Stripe · Internacional</h3><p>Contribua pelo checkout seguro do Stripe.</p><button className="primary" onClick={()=>void call('support',{action:'stripe'})}>Contribuir via Stripe ↗</button><button className="text-button" onClick={()=>void call('support',{action:'stripe-copy'})}>Copiar link do Stripe</button><p>O apoio é voluntário. Todas as funções estão disponíveis sem contribuição.</p></section></div><details><summary>Licenças dos componentes</summary><pre>{licenses}</pre></details></section></div>}
        <footer>
          <span>
            <i className={`dot ${engineDot(snapshot)}`} />
            {snapshot?.engine.available?t.ready:t.missing}
          </span>
          <span>
            GCP-Drive <b>{snapshot?.version ?? ""}</b>
            <span className="footer-divider" />{" "}
            {snapshot?.platform === "win32"
              ? "Windows"
              : snapshot?.platform === "darwin"
                ? "macOS"
                : "Linux"}
          </span>
        </footer>
      </div>
      {modal && (
        <div className="modal-backdrop">
          <section
            className="modal connection-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t.connect}
          >
            <button
              className="modal-close"
              aria-label={t.cancel}
              onClick={() => void cancelConnection()}
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              <Cloud size={32} />
            </span>
            <span className="eyebrow">GCP-DRIVE</span>
            <h2>{session ? t.login : t.connect}</h2>
            <p>{providers[kind].oauth?t.browser:'Conecte sua conta por autenticação direta protegida neste computador.'}</p>
            {authError && <div className="error" role="alert">{authError}<small>Confira a conexão e clique em Continuar para tentar novamente.</small></div>}
            {finished ? (
              <div className="login-done">
                <ShieldCheck size={48} />
                <h3>{t.done}</h3>
                {session?.question.MountMessage && (
                  <div className="error">{session.question.MountMessage}</div>
                )}
                <button
                  className="primary"
                  onClick={() => {
                    setModal(false);
                    setView("home");
                  }}
                >
                  {t.continue}
                  <ArrowRight size={17} />
                </button>
              </div>
            ) : session ? (
              <>
                <div className="question">
                  <h4>{session.question.Title ?? t.login}</h4>
                  <p>{session.question.Description ?? t.browser}</p>
                  {session.question.Error && (
                    <div className="error">{session.question.Error}</div>
                  )}
                  {session.question.Option?.Examples?.length ? (
                    <select
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    >
                      {session.question.Option.Examples.map((e) => (
                        <option key={e.Value} value={e.Value}>
                          {e.Help}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      autoFocus
                      aria-label={t.answer}
                      type={
                        session.question.Option?.IsPassword
                          ? "password"
                          : "text"
                      }
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                  )}
                </div>
                <button
                  className="primary modal-submit"
                  disabled={busy}
                  onClick={() =>
                    void authAction(async () => {
                      const generation = authGeneration.current;
                      const q = await call("answer", {
                        accountId: session.accountId,
                        answer,
                      });
                      if (generation !== authGeneration.current) return;
                      if (!q.State) {
                        setSession({ ...session, question: q });
                        setFinished(true);
                      } else {
                        setSession({ ...session, question: q });
                        setAnswer(String(q.Option?.Default ?? ""));
                      }
                    })
                  }
                >
                  {busy ? t.pending : t.continue}
                  {busy ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                </button>
              </>
            ) : (
              <>
                <label>{t.provider}</label>
                <div className="provider-picker">
                  {(Object.keys(providers) as Provider[]).map((p) => (
                    <button
                      key={p}
                      className={kind === p ? "chosen" : ""}
                      onClick={() => {setKind(p);setLoginUser('');setLoginPassword('');setLoginOtp('');setLoginMailbox('');setAuthError('');}}
                    >
                      <ProviderMark type={p} />
                      {providers[p].name}
                      {kind === p && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <ConnectionFields key={kind} provider={kind} label={label} onLabel={setLabel} accountLabel={t.accountName} placeholder={t.accountPlaceholder} user={loginUser} password={loginPassword} otp={loginOtp} mailbox={loginMailbox} onUser={setLoginUser} onPassword={setLoginPassword} onOtp={setLoginOtp} onMailbox={setLoginMailbox}/>
                <button
                  className="primary modal-submit"
                  disabled={
                    busy || !label.trim() || !snapshot?.engine.available || (!providers[kind].oauth&&(!loginUser.trim()||!loginPassword))
                  }
                  onClick={() =>
                    void authAction(async () => {
                      const generation = authGeneration.current;
                      const connecting = call("connect", {
                        label,
                        provider: kind,
                        ...(!providers[kind].oauth?{credentials:{user:loginUser,password:loginPassword,otp:loginOtp,mailbox:loginMailbox}}:{}),
                      });
                      setLoginPassword('');setLoginOtp('');setLoginMailbox('');
                      const result=await connecting;
                      if (generation !== authGeneration.current) return;
                      setSession(result);
                      setAnswer(String(result.question.Option?.Default ?? ""));
                      if (!result.question.State) setFinished(true);
                    })
                  }
                >
                  {busy ? t.pending : t.continue}
                  {busy ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                </button>
                {!snapshot?.engine.available && (
                  <button
                    className="text-button"
                    onClick={() =>
                      void action(() => call("chooseEngine", null))
                    }
                  >
                    {t.settings}
                  </button>
                )}
              </>
            )}
            <div className="modal-security">
              <ShieldCheck size={14} /> {t.login} · {t.work}
            </div>
            {!finished && (session || busy) && (
              <button
                className="cancel-login"
                onClick={() => void cancelConnection()}
              >
                {controls.cancel}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function engineDot(s?: Snapshot) {
  return !s?.engine.available
    ? "orange"
    : s.mounts.some((m) => m.phase === "error" || m.sync === "problem")
      ? "red"
      : s.mounts.some((m) => m.sync === "transferring")
        ? "orange"
        : s.mounts.length && s.mounts.every((m) => m.sync === "idle")
          ? "green"
          : "gray";
}
createRoot(document.getElementById("root")!).render(<App />);

function formatBytes(value:number){return new Intl.NumberFormat("pt-BR",{maximumFractionDigits:1}).format(value>=1073741824?value/1073741824:value>=1048576?value/1048576:value/1024)+(value>=1073741824?" GB":value>=1048576?" MB":" KB");}
