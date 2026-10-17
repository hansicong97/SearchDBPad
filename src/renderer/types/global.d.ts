/// <reference types="vite/client" />

import type { SearchApi } from '../../preload'

declare global {
  interface Window {
    searchApi: SearchApi
    /** Set by `monacoEnv.ts` so Monaco's web workers can be loaded. */
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker
    }
  }
}

export {}