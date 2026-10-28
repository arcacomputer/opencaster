import { contextBridge, ipcRenderer } from 'electron';
import type { ArcaSignerBridge } from './bridge';

// Explicit methods only. Never expose ipcRenderer, filesystem, or shell access.
const bridge: ArcaSignerBridge = Object.freeze({
  importRequest: () => ipcRenderer.invoke('arca:import-request'),
  approve: (input: { phrase: string; requestId: string }) => ipcRenderer.invoke('arca:approve', input),
  exportApproval: () => ipcRenderer.invoke('arca:export-approval'),
  clear: () => ipcRenderer.invoke('arca:clear'),
  quit: () => ipcRenderer.invoke('arca:quit'),
});
contextBridge.exposeInMainWorld('arcaSigner', bridge);
