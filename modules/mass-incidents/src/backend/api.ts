import * as sdk from 'botpress/sdk'
import { IncidentService } from './service'

/**
 * Configura los endpoints de la API REST para el módulo de incidencias
 */
export const setupApi = (bp: typeof sdk, incidentService: IncidentService) => {
  const router = bp.http.createRouterForBot('mass-incidents')

  /**
   * GET /api/v1/bots/:botId/mod/mass-incidents/incidents
   * Obtiene el estado actual de la incidencia
   */
  router.get('/incidents', async (req, res) => {
    try {
      const botId = req.params.botId
      const result = await incidentService.getIncidentStatus(botId)

      res.status(result.success ? 200 : 500).json(result)
    } catch (error) {
      bp.logger.error('[mass-incidents] API Error (GET /incidents):', error)
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      })
    }
  })

  /**
   * POST /api/v1/bots/:botId/mod/mass-incidents/incidents
   * Crea o actualiza una incidencia
   */
  router.post('/incidents', async (req, res) => {
    try {
      const botId = req.params.botId
      const { message } = req.body
      const userId = (req as any).tokenUser?.email || (req as any).tokenUser?.id || 'unknown'

      if (!message) {
        return res.status(400).json({
          success: false,
          error: 'El campo "message" es obligatorio'
        })
      }

      const result = await incidentService.setIncident(botId, message, userId)

      res.status(result.success ? 200 : 400).json(result)
    } catch (error) {
      bp.logger.error('[mass-incidents] API Error (POST /incidents):', error)
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      })
    }
  })

  /**
   * DELETE /api/v1/bots/:botId/mod/mass-incidents/incidents
   * Desactiva la incidencia activa
   */
  router.delete('/incidents', async (req, res) => {
    try {
      const botId = req.params.botId
      const userId = (req as any).tokenUser?.email || (req as any).tokenUser?.id || 'unknown'

      const result = await incidentService.deactivateIncident(botId, userId)

      res.status(result.success ? 200 : 500).json(result)
    } catch (error) {
      bp.logger.error('[mass-incidents] API Error (DELETE /incidents):', error)
      res.status(500).json({
        success: false,
        error: 'Error interno del servidor'
      })
    }
  })
}
