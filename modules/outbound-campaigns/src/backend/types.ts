/**
 * Tipos e interfaces para el módulo de Campañas Salientes
 */

// Estados posibles de una campaña
export type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed'

// Estados posibles de un destinatario
export type RecipientStatus = 'pending' | 'processing' | 'sent' | 'failed'

// Tipos de eventos para logs
export type LogEventType =
  | 'created'
  | 'updated'
  | 'recipients_imported'
  | 'started'
  | 'paused'
  | 'resumed'
  | 'message_sent'
  | 'message_failed'
  | 'batch_completed'
  | 'completed'
  | 'failed'

/**
 * Campaña principal
 */
export interface Campaign {
  id: number
  bot_id: string
  name: string
  template_id: string
  template_namespace?: string
  template_language?: string
  status: CampaignStatus
  batch_size: number
  batch_interval_ms: number
  total_recipients: number
  sent_count: number
  failed_count: number
  last_batch_at?: Date
  created_at: Date
  updated_at: Date
  started_at?: Date
  completed_at?: Date
}

/**
 * Fila de campaña tal como se guarda en la base de datos
 */
export interface CampaignRow {
  id?: number
  bot_id: string
  name: string
  template_id: string
  template_namespace?: string
  template_language?: string
  status: CampaignStatus
  batch_size: number
  batch_interval_ms: number
  total_recipients: number
  sent_count: number
  failed_count: number
  last_batch_at?: string
  created_at: string
  updated_at: string
  started_at?: string
  completed_at?: string
}

/**
 * Destinatario de una campaña
 */
export interface Recipient {
  id: number
  campaign_id: number
  phone_number: string
  variables: Record<string, string>
  status: RecipientStatus
  retry_count: number
  error_message?: string
  message_uuid?: string
  sent_at?: Date
  created_at: Date
}

/**
 * Fila de destinatario tal como se guarda en la base de datos
 */
export interface RecipientRow {
  id?: number
  campaign_id: number
  phone_number: string
  variables: string // JSON stringified
  status: RecipientStatus
  retry_count: number
  error_message?: string
  message_uuid?: string
  sent_at?: string
  created_at: string
}

/**
 * Log de auditoría de campaña
 */
export interface CampaignLog {
  id: number
  campaign_id: number
  recipient_id?: number
  event_type: LogEventType
  event_data: Record<string, any>
  created_at: Date
}

/**
 * Fila de log tal como se guarda en la base de datos
 */
export interface CampaignLogRow {
  id?: number
  campaign_id: number
  recipient_id?: number
  event_type: LogEventType
  event_data: string // JSON stringified
  created_at: string
}

/**
 * Datos para crear una nueva campaña
 */
export interface CreateCampaignInput {
  name: string
  template_id: string
  template_namespace?: string
  template_language?: string
  batch_size?: number
  batch_interval_ms?: number
}

/**
 * Datos para actualizar una campaña
 */
export interface UpdateCampaignInput {
  name?: string
  template_id?: string
  template_namespace?: string
  template_language?: string
  batch_size?: number
  batch_interval_ms?: number
}

/**
 * Resultado de importación de CSV
 */
export interface CSVImportResult {
  valid: number
  invalid: number
  duplicates: number
  errors: CSVImportError[]
}

/**
 * Error de importación de CSV
 */
export interface CSVImportError {
  row: number
  phone_number?: string
  message: string
}

/**
 * Configuración de Vonage del bot
 */
export interface VonageConfig {
  enabled: boolean
  apiKey: string
  apiSecret: string
  applicationId: string
  privateKey: string
  whatsappNumber?: string
}

/**
 * Resultado de envío de mensaje
 */
export interface SendMessageResult {
  success: boolean
  message_uuid?: string
  error?: string
}

/**
 * Reporte de campaña
 */
export interface CampaignReport {
  campaign: Campaign
  metrics: {
    total: number
    pending: number
    processing: number
    sent: number
    failed: number
    progress_percentage: number
  }
  logs: CampaignLog[]
}

/**
 * Fila de destinatario fallido para exportación
 */
export interface FailedRecipientExport {
  phone_number: string
  error_message: string
  retry_count: number
  variables: string
}
