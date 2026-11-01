import { contextBridge, ipcRenderer } from "electron";
import type { DriveAPI } from "./contracts.ts";
const api: DriveAPI = {
  platform: process.platform,
  onLocation: callback=>{const listener=(_event:unknown,location:{accountId:string;path:string})=>callback(location);ipcRenderer.on('gcp-location',listener);return()=>ipcRenderer.removeListener('gcp-location',listener);},
  onView: callback => {const listener=(_event:unknown,view:string)=>callback(view);ipcRenderer.on('gcp-view',listener);return ()=>ipcRenderer.removeListener('gcp-view',listener);},
  call: (operation, input) => ipcRenderer.invoke("gcp-drive", operation, input),
};
contextBridge.exposeInMainWorld("gcpDrive", Object.freeze(api));
