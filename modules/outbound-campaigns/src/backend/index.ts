import * as sdk from 'botpress/sdk'

import en from '../translations/en.json'
import es from '../translations/es.json'

import OutboundCampaignsDb from './db'
import { OutboundCampaignsService } from './service'
import { setupApi } from './api'
import { startDaemon, stopDaemon } from './daemon'

let db: OutboundCampaignsDb
let service: OutboundCampaignsService

const onServerStarted = async (bp: typeof sdk) => {
  try {
    // Inicializar base de datos
    db = new OutboundCampaignsDb(bp)
    await db.initialize()

    // Inicializar servicio
    service = new OutboundCampaignsService(bp, db)
  } catch (error: any) {
    bp.logger.error(`[outbound-campaigns] Failed to initialize: ${error.message}`)
    throw error
  }
}

const onServerReady = async (bp: typeof sdk) => {
  try {
    // Configurar API endpoints
    setupApi(bp, service)

    // Iniciar daemon de procesamiento
    startDaemon(bp, service)
  } catch (error: any) {
    bp.logger.error(`[outbound-campaigns] Failed in onServerReady: ${error.message}`)
    throw error
  }
}

const onBotMount = async (bp: typeof sdk, botId: string) => {
  // Verificar si Vonage está configurado para este bot (silencioso)
  await service.isVonageConfigured(botId)
}

const onBotUnmount = async (bp: typeof sdk, botId: string) => {
  // Cleanup silencioso
}

const onModuleUnmount = async (bp: typeof sdk) => {
  // Detener daemon cuando el módulo se desmonta
  stopDaemon()
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted,
  onServerReady,
  onBotMount,
  onBotUnmount,
  onModuleUnmount,
  translations: { en, es },
  definition: {
    name: 'outbound-campaigns',
    fullName: 'Campañas Salientes',
    homepage: 'https://botpress.com',
    menuIcon: 'send-message',
    menuText: 'Campañas Salientes',
    noInterface: false
  }
}

export default entryPoint
