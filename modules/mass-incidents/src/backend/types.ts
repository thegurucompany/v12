import * as sdk from 'botpress/sdk'

// Definición de tipos para el módulo
export interface IncidentData {
  message: string
  active: boolean
  createdAt: Date
  createdBy: string
  updatedAt?: Date
  updatedBy?: string
}

export interface IncidentResponse {
  success: boolean
  data?: IncidentData
  error?: string
}

// Constantes para KVS
export const KVS_KEY_PREFIX = 'mass-incident'
export const getIncidentKey = (botId: string) => `${KVS_KEY_PREFIX}::${botId}`
