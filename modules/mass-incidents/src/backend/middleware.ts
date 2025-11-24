import * as sdk from 'botpress/sdk'
import { IncidentService } from './service'

/**
 * Middleware de inyección de incidencias masivas
 * Se ejecuta ANTES del procesamiento de eventos entrantes
 * Latencia: < 1ms (lectura directa de KVS)
 */
export const setupMiddleware = (bp: typeof sdk, incidentService: IncidentService) => {
  bp.events.registerMiddleware({
    name: 'mass-incidents.inject',
    description: 'Inyecta mensajes de incidencia masiva en el contexto del evento',
    order: 10, // Ejecutar temprano en la cadena de middleware
    direction: 'incoming',
    handler: async (event: sdk.IO.IncomingEvent, next: sdk.IO.MiddlewareNextCallback) => {
      try {
        // Solo procesar eventos de usuarios (no internos)
        if (!event.botId || event.type === 'proactive-trigger') {
          return next()
        }

        // Lectura ultra-rápida del KVS (< 1ms)
        const incident = await incidentService.getActiveIncident(event.botId)

        if (incident && incident.active) {
          // Inyectar en el estado temporal del evento
          const evt = event as any
          evt.state = evt.state || {}
          evt.state.temp = evt.state.temp || {}
          evt.state.temp.massIncident = {
            active: true,
            message: incident.message,
            injectedAt: new Date().toISOString()
          }

          // Almacenar en nlu contexts (si existe)
          if (evt.nlu) {
            evt.nlu.includedContexts = evt.nlu.includedContexts || []
            evt.nlu.includedContexts.push('mass-incident')
          }

          // Guardar en payload para acceso fácil
          evt.payload = evt.payload || {}
          evt.payload.massIncidentActive = true
          evt.payload.massIncidentMessage = incident.message
        }

        next()
      } catch (error) {
        // Fallo silencioso - nunca bloquear el flujo del bot
        bp.logger.forBot(event.botId).warn(`[mass-incidents] Middleware error (non-blocking):`, error)
        next()
      }
    }
  })
}

/**
 * Helper para usar en acciones de código o hooks
 * Permite verificar si hay una incidencia activa
 */
export const checkIncidentInAction = async (bp: typeof sdk, event: sdk.IO.Event): Promise<string | null> => {
  try {
    const evt = event as any
    const incident = evt.state?.temp?.massIncident
    if (incident && incident.active) {
      return incident.message
    }
    return null
  } catch {
    return null
  }
}
