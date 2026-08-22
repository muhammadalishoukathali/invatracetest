/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_MODEL_MANIFEST_URL: string
  readonly VITE_RELEASE_ID: string
  readonly VITE_ENABLE_MOCKS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
