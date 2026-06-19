/// <reference types="vite/client" />

import type { EsApi } from '../../preload'

declare global {
  interface Window {
    esApi: EsApi
    /** Set by `monacoEnv.ts` so Monaco's web workers can be loaded. */
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker
    }
  }
}

export {}