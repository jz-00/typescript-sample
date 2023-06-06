export interface Env {
    ENVIRONMENT: string
    LOG_LEVEL: LogLevel
    CDN_PATH: string
    GOOGLE_PROJECT_ID: string
    CF_BUCKET: R2Bucket
    GOOGLE_AUTH_KV: KVNamespace
}
