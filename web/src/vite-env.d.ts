/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AG?: string;
  readonly VITE_RPC_URL?: string;
  readonly VITE_TEST_YEREL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
