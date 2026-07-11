/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WHATSAPP_PHONE?: string;
  readonly VITE_WHATSAPP_BUSINESS_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
