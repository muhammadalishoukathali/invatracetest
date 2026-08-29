/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_MODEL_MANIFEST_URL: string
  readonly VITE_RELEASE_ID: string
  readonly VITE_ENABLE_MOCKS: string
  readonly VITE_ENABLE_FAKE_MODEL: string
  readonly VITE_ENABLE_REAL_MODEL?: string
  readonly VITE_MODEL_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
