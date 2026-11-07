export type Provider = keyof typeof import('./providers.ts').providers;
export type Language = "pt-BR" | "en" | "es";
export type Account = {
  id: string;
  label: string;
  provider: Provider;
  autoMount: boolean;
  mountLetter?: string;
  mountFolder?: string;
};
export type Favorite = { accountId: string; path: string; name: string;isDir?:boolean;size?:number;modified?:string };
export type FolderPlan = {
  id: string;
  accountId: string;
  localPath: string;
  remotePath: string;
  enabled: boolean;
  initialized: boolean;
};
export type FolderSyncState = {
  id: string;
  phase: "paused" | "previewing" | "ready" | "syncing" | "idle" | "error";
  message?: string;
  lastSuccess?: string;
};
export type FolderPreview = {
  planId: string;
  localFiles: number;
  cloudFiles: number;
  sameNames: number;
  historyLocal: string;
  historyRemote: string;
};
export type Preferences = {
  version: 1;
  accounts: Account[];
  favorites: Favorite[];
  language: Language;
  startAtLogin: boolean;
  rclonePath?: string;
  folderPlans?: FolderPlan[];
  loginDrafts?: Account[];
  importedMountedShortcuts?:string[];
  theme?:string;
  customThemes?:import('./themes.ts').ThemeDefinition[];
  updateFrequency?:import('./updates.ts').UpdateFrequency;
  lastUpdateCheck?:string;
};
export type MountState = {
  transfers?: {path:string; bytes:number; size:number; speed:number; phase:"transferring"|"waiting"|"queued"|"problem"|"complete"}[];
  cache?: {bytes:number; files:number; queued:number; uploading:number; errors:number};
  accountId: string;
  phase: "starting" | "running" | "stopping" | "error";
  path: string;
  message?: string;
  sync: "unknown" | "idle" | "transferring" | "problem";
  observedAt?: string;
};
/** Observed from the mount's VFS cache metadata: local = whole file on disk, partial = some ranges, pending = unsent change. */
export type CacheState = "local" | "partial" | "pending" | "cloud" | "unknown";
export type Entry = {
  IconKey?: string;
  State?: CacheState;
  Name: string;
  Path: string;
  Size: number;
  IsDir: boolean;
  ModTime: string;
};
export type Activity = { id?:string;at: string; message: string; level: "info" | "error";accountId?:string;path?:string;kind?:'file'|'folder' };
export type SearchHitView = import('./index-store.ts').SearchHit & {IconKey:string};
export type Snapshot = {
  updates?:import('./updates.ts').UpdateState;
  requestedView?:string;
  version: string;
  preferences: Preferences;
  mounts: MountState[];
  activity: Activity[];
  activityCursor?:string;
  engine: { available: boolean; version?: string; error?: string };
  platform: string;
  vault: boolean;
  folderSyncs: FolderSyncState[];
  mountSupport: { available: boolean; message: string; installURL?: string };
};
export type Question = {
  State: string;
  Title?: string;
  Description?: string;
  MountMessage?: string;
  Error?: string;
  Option?: {
    Name: string;
    Help: string;
    Default: unknown;
    IsPassword?: boolean;
    Type?: string;
    Exclusive?: boolean;
    Examples?: { Value: string; Help: string }[];
  };
};
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export type Operations = {
  activityHistory:{input:{before?:string};output:{items:Activity[];cursor?:string}};
  clearActivity:{input:null;output:null};
  updateSettings:{input:{frequency:import('./updates.ts').UpdateFrequency};output:null};
  checkUpdates:{input:null;output:null};
  downloadUpdate:{input:{format?:'deb'|'rpm'|'appimage'};output:null};
  cancelUpdate:{input:null;output:null};
  installUpdate:{input:null;output:null};
  appearance:{input:{theme:string};output:null};
  installTheme:{input:null;output:null};
  refreshShared:{input:{accountId:string};output:null};
  support:{input:{action:'pix'|'stripe'|'stripe-copy'|'website'};output:null};
  renameAccount:{input:{accountId:string;label:string};output:null};
  fullscreen: {input:null;output:boolean};
  download: {input:{accountId:string;path:string};output:null};
  rename: {input:{accountId:string;path:string;name:string};output:null};
  removeFolder: {input:{planId:string};output:null};
  refreshFolder: {input:{accountId:string;path:string};output:null};
  storage: {input:{accountId:string};output:{cacheBytes:number;cacheFiles:number;canClear:boolean;offlineBytes:number}};
  clearCache: {input:{accountId:string};output:null};
  web: {input:{accountId:string;path:string;share?:boolean};output:string};
  nativeIcons: { input: { names: import('./native-icon-names.ts').NativeIconName[] }; output: Partial<Record<import('./native-icon-names.ts').NativeIconName,string>> };
  fileIcons: { input: { keys: string[] }; output: Record<string,string> };
  licenses: { input: null; output: string };
  cancelLogin: { input: null; output: null };
  disconnect: { input: { accountId: string }; output: null };
  openMountSupport: { input: null; output: null };
  quit: { input: null; output: null };
  addFolder: {
    input: { accountId: string; remotePath: string };
    output: FolderPlan | null;
  };
  previewFolder: { input: { planId: string }; output: FolderPreview };
  startFolder: { input: { planId: string }; output: null };
  pauseFolder: { input: { planId: string }; output: null };
  snapshot: { input: null; output: Snapshot };
  chooseEngine: { input: null; output: boolean };
  connect: {
    input: { label: string; provider: Provider; credentials?:{user:string;password:string;otp?:string;mailbox?:string} };
    output: { accountId: string; question: Question };
  };
  answer: { input: { accountId: string; answer: string }; output: Question };
  list: { input: { accountId: string; path: string }; output: Entry[] };
  search: {
    input: { accountId: string; query: string };
    output: {
      hits: SearchHitView[];
      coverage: "visited-folders-only";
    };
  };
  mount: { input: { accountId: string }; output: null };
  open: { input: { accountId: string; path: string }; output: null };
  favorite: { input: Favorite; output: null };
  preferences: {
    input: { language: Language; startAtLogin: boolean };
    output: null;
  };
};
export type DriveAPI = {
  onLocation:(callback:(location:{accountId:string;path:string})=>void)=>()=>void;
  onView: (callback:(view:string)=>void)=>()=>void;
  platform: string;
  call<K extends keyof Operations>(
    operation: K,
    input: Operations[K]["input"],
  ): Promise<Reply<Operations[K]["output"]>>;
};
