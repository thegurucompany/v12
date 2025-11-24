import * as sdk from 'botpress/sdk'
import Joi from 'joi'
import { IncidentData, IncidentResponse, getIncidentKey } from './types'

/**
 * Servicio de gestión de incidencias masivas
 * Usa KVS para lecturas ultra-rápidas (< 1ms)
 */
export class IncidentService {
  constructor(private bp: typeof sdk) {}

  /**
   * Obtiene la incidencia activa para un bot (lectura optimizada)
   * @param botId ID del bot
   * @returns Datos de la incidencia o null si no existe/está inactiva
   */
  async getActiveIncident(botId: string): Promise<IncidentData | null> {
    try {
      const key = getIncidentKey(botId)
      const data = await this.bp.kvs.forBot(botId).get(key)

      if (!data || !data.active) {
        return null
      }

      return data as IncidentData
    } catch (error) {
      // Fallo silencioso - el bot debe continuar funcionando
      this.bp.logger.warn(`[mass-incidents] Error reading incident for bot ${botId}:`, error)
      return null
    }
  }

  /**
   * Guarda o actualiza una incidencia
   * @param botId ID del bot
   * @param message Mensaje de incidencia
   * @param userId ID del usuario que crea/actualiza
   */
  async setIncident(botId: string, message: string, userId: string): Promise<IncidentResponse> {
    try {
      // Validación del mensaje
      const schema = Joi.object({
        message: Joi.string()
          .min(1)
          .max(5000)
          .required()
      })

      const { error } = schema.validate({ message })
      if (error) {
        return {
          success: false,
          error: `Validación fallida: ${error.message}`
        }
      }

      const key = getIncidentKey(botId)
      const existingData = await this.bp.kvs.forBot(botId).get(key)

      const incidentData: IncidentData = {
        message: message.trim(),
        active: true,
        createdAt: existingData?.createdAt || new Date(),
        createdBy: existingData?.createdBy || userId,
        updatedAt: new Date(),
        updatedBy: userId
      }

      await this.bp.kvs.forBot(botId).set(key, incidentData)

      this.bp.logger.info(`[mass-incidents] Incident activated for bot ${botId} by user ${userId}`)

      return {
        success: true,
        data: incidentData
      }
    } catch (error) {
      this.bp.logger.error(`[mass-incidents] Error setting incident for bot ${botId}:`, error)
      return {
        success: false,
        error: 'Error al guardar la incidencia'
      }
    }
  }

  /**
   * Desactiva la incidencia (no la elimina, solo la marca como inactiva)
   * @param botId ID del bot
   * @param userId ID del usuario que desactiva
   */
  async deactivateIncident(botId: string, userId: string): Promise<IncidentResponse> {
    try {
      const key = getIncidentKey(botId)
      const existingData = await this.bp.kvs.forBot(botId).get(key)

      if (!existingData) {
        return {
          success: true,
          data: null
        }
      }

      const incidentData: IncidentData = {
        ...existingData,
        active: false,
        updatedAt: new Date(),
        updatedBy: userId
      }

      await this.bp.kvs.forBot(botId).set(key, incidentData)

      this.bp.logger.info(`[mass-incidents] Incident deactivated for bot ${botId} by user ${userId}`)

      return {
        success: true,
        data: incidentData
      }
    } catch (error) {
      this.bp.logger.error(`[mass-incidents] Error deactivating incident for bot ${botId}:`, error)
      return {
        success: false,
        error: 'Error al desactivar la incidencia'
      }
    }
  }

  /**
   * Obtiene el estado actual de la incidencia (activa o no)
   * @param botId ID del bot
   */
  async getIncidentStatus(botId: string): Promise<IncidentResponse> {
    try {
      const key = getIncidentKey(botId)
      const data = await this.bp.kvs.forBot(botId).get(key)

      return {
        success: true,
        data: data || null
      }
    } catch (error) {
      this.bp.logger.error(`[mass-incidents] Error getting incident status for bot ${botId}:`, error)
      return {
        success: false,
        error: 'Error al obtener el estado de la incidencia'
      }
    }
  }
}
