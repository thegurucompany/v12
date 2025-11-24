import * as sdk from 'botpress/sdk'
import { IncidentService } from './service'
import { setupApi } from './api'
import { setupMiddleware } from './middleware'

import en from '../translations/en.json'
import es from '../translations/es.json'

let incidentService: IncidentService

const onServerStarted = async (bp: typeof sdk) => {
  // Inicializar el servicio de incidencias
  incidentService = new IncidentService(bp)

  bp.logger.info('[mass-incidents] Module initialized - using KVS for ultra-fast reads')
}

const onServerReady = async (bp: typeof sdk) => {
  // Configurar API endpoints
  setupApi(bp, incidentService)

  // Configurar middleware de inyección
  setupMiddleware(bp, incidentService)

  bp.logger.info('[mass-incidents] API and middleware ready')
}

const onBotMount = async (bp: typeof sdk, botId: string) => {
  // Log cuando un bot se monta (opcional, para debugging)
  const incident = await incidentService.getActiveIncident(botId)
  if (incident) {
    bp.logger.forBot(botId).info('[mass-incidents] Bot mounted with active incident')
  }
}

const entryPoint: sdk.ModuleEntryPoint = {
  onServerStarted,
  onServerReady,
  onBotMount,
  translations: { en, es },
  definition: {
    name: 'mass-incidents',
    fullName: 'Incidencias Masivas',
    homepage: 'https://botpress.com',
    menuIcon: 'warning-sign',
    menuText: 'Incidencias Masivas',
    noInterface: false
  }
}

export default entryPoint
