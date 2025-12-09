import * as sdk from 'botpress/sdk'
import _ from 'lodash'
import { Readable } from 'stream'

import OutboundCampaignsDb from './db'
import {
  Campaign,
  CampaignStatus,
  CreateCampaignInput,
  UpdateCampaignInput,
  CSVImportResult,
  CSVImportError,
  CampaignReport,
  Recipient
} from './types'
import { isVonageConfigured, isValidE164, normalizePhoneNumber, sendWhatsAppTemplate } from './vonage'

export class OutboundCampaignsService {
  private bp: typeof sdk
  private db: OutboundCampaignsDb

  constructor(bp: typeof sdk, db: OutboundCampaignsDb) {
    this.bp = bp
    this.db = db
  }

  // ==================== VONAGE VALIDATION ====================

  /**
   * Verifica si Vonage está configurado para el bot
   */
  async isVonageConfigured(botId: string): Promise<boolean> {
    return isVonageConfigured(this.bp, botId)
  }

  // ==================== CAMPAIGN CRUD ====================

  /**
   * Crea una nueva campaña
   */
  async createCampaign(botId: string, input: CreateCampaignInput): Promise<Campaign> {
    const campaign = await this.db.createCampaign(botId, input)

    // Log de creación
    await this.db.createLog(campaign.id, 'created', {
      name: input.name,
      template_id: input.template_id,
      batch_size: input.batch_size || 100,
      batch_interval_ms: input.batch_interval_ms || 60000
    })

    this.bp.logger.forBot(botId).info(`[outbound-campaigns] Campaign created: ${campaign.name} (ID: ${campaign.id})`)

    return campaign
  }

  /**
   * Obtiene una campaña por ID
   */
  async getCampaign(campaignId: number): Promise<Campaign | null> {
    return this.db.getCampaignById(campaignId)
  }

  /**
   * Obtiene todas las campañas de un bot
   */
  async getCampaigns(botId: string): Promise<Campaign[]> {
    return this.db.getCampaignsByBotId(botId)
  }

  /**
   * Actualiza una campaña (solo si está en estado draft)
   */
  async updateCampaign(campaignId: number, input: UpdateCampaignInput): Promise<Campaign | null> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      return null
    }

    if (campaign.status !== 'draft') {
      throw new Error('Cannot modify campaign that is not in draft status')
    }

    const updated = await this.db.updateCampaign(campaignId, input)

    if (updated) {
      await this.db.createLog(campaignId, 'updated', { changes: input })
    }

    return updated
  }

  /**
   * Elimina una campaña
   */
  async deleteCampaign(campaignId: number): Promise<void> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    // No permitir eliminar campañas en ejecución
    if (campaign.status === 'running') {
      throw new Error('Cannot delete a running campaign. Pause it first.')
    }

    await this.db.deleteCampaign(campaignId)
    this.bp.logger.info(`[outbound-campaigns] Campaign deleted: ${campaign.name} (ID: ${campaignId})`)
  }

  // ==================== CSV PROCESSING ====================

  /**
   * Procesa un archivo CSV y carga los destinatarios
   */
  async processCSV(campaignId: number, fileBuffer: Buffer): Promise<CSVImportResult> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    if (campaign.status !== 'draft') {
      throw new Error('Can only upload recipients to campaigns in draft status')
    }

    const result: CSVImportResult = {
      valid: 0,
      invalid: 0,
      duplicates: 0,
      errors: []
    }

    try {
      // Parsear CSV
      const records = await this.parseCSV(fileBuffer)

      if (records.length === 0) {
        throw new Error('CSV file is empty')
      }

      // Verificar que existe la columna phone_number
      const firstRecord = records[0]
      if (!firstRecord.hasOwnProperty('phone_number')) {
        throw new Error('CSV must have a "phone_number" column')
      }

      // Procesar registros
      const validRecipients: Array<{ phone_number: string; variables: Record<string, string> }> = []
      const seenPhones = new Set<string>()

      for (let i = 0; i < records.length; i++) {
        const record = records[i]
        const rowNumber = i + 2 // +2 porque línea 1 es header y arrays empiezan en 0
        const rawPhone = record.phone_number

        if (!rawPhone || rawPhone.trim() === '') {
          result.invalid++
          result.errors.push({
            row: rowNumber,
            phone_number: rawPhone,
            message: 'Phone number is empty'
          })
          continue
        }

        // Normalizar número
        const normalizedPhone = normalizePhoneNumber(rawPhone.trim())

        if (!normalizedPhone) {
          result.invalid++
          result.errors.push({
            row: rowNumber,
            phone_number: rawPhone,
            message: 'Invalid phone number format. Use 10 digits (e.g., 4422591631) or E.164 format (e.g., +5214422591631)'
          })
          continue
        }

        // Verificar duplicados
        if (seenPhones.has(normalizedPhone)) {
          result.duplicates++
          continue
        }

        seenPhones.add(normalizedPhone)

        // Extraer variables (todas las columnas excepto phone_number)
        const variables: Record<string, string> = {}
        for (const [key, value] of Object.entries(record)) {
          if (key !== 'phone_number' && value !== undefined && value !== null) {
            variables[key] = String(value)
          }
        }

        validRecipients.push({
          phone_number: normalizedPhone,
          variables
        })

        result.valid++
      }

      // Eliminar destinatarios anteriores si existen
      await this.db.deleteRecipientsByCampaign(campaignId)

      // Insertar nuevos destinatarios en lotes
      if (validRecipients.length > 0) {
        await this.db.insertRecipientsBatch(campaignId, validRecipients)
      }

      // Actualizar contador total en la campaña
      await this.db.updateTotalRecipients(campaignId, validRecipients.length)

      // Log de importación
      await this.db.createLog(campaignId, 'recipients_imported', {
        valid: result.valid,
        invalid: result.invalid,
        duplicates: result.duplicates,
        errors_count: result.errors.length
      })

      this.bp.logger.info(
        `[outbound-campaigns] CSV processed for campaign ${campaignId}: ` +
        `${result.valid} valid, ${result.invalid} invalid, ${result.duplicates} duplicates`
      )

      // Limitar errores retornados para no saturar la respuesta
      if (result.errors.length > 100) {
        result.errors = result.errors.slice(0, 100)
      }

      return result
    } catch (error) {
      this.bp.logger.error(`[outbound-campaigns] Error processing CSV: ${error.message}`)
      throw error
    }
  }

  /**
   * Parsea un buffer CSV y retorna un array de objetos
   */
  private async parseCSV(buffer: Buffer): Promise<Record<string, string>[]> {
    return new Promise((resolve, reject) => {
      const { parse } = require('csv-parse')
      const records: Record<string, string>[] = []

      const parser = parse({
        columns: true, // Usar primera fila como headers
        skip_empty_lines: true,
        trim: true,
        bom: true, // Manejar BOM de UTF-8
        relaxColumnCount: true
      })

      parser.on('readable', () => {
        let record
        while ((record = parser.read()) !== null) {
          records.push(record)
        }
      })

      parser.on('error', (err: Error) => {
        reject(new Error(`CSV parsing error: ${err.message}`))
      })

      parser.on('end', () => {
        resolve(records)
      })

      // Escribir buffer al parser
      parser.write(buffer)
      parser.end()
    })
  }

  // ==================== CAMPAIGN ACTIONS ====================

  /**
   * Inicia una campaña
   */
  async startCampaign(campaignId: number): Promise<Campaign> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      throw new Error(`Cannot start campaign in status: ${campaign.status}`)
    }

    if (campaign.total_recipients === 0) {
      throw new Error('Cannot start campaign without recipients. Upload a CSV first.')
    }

    // Verificar Vonage configurado
    const isVonageOk = await isVonageConfigured(this.bp, campaign.bot_id)
    if (!isVonageOk) {
      throw new Error('Vonage is not configured for this bot')
    }

    await this.db.updateCampaignStatus(campaignId, 'running')

    await this.db.createLog(campaignId, 'started', {
      previous_status: campaign.status,
      total_recipients: campaign.total_recipients
    })

    this.bp.logger.forBot(campaign.bot_id).info(`[outbound-campaigns] Campaign started: ${campaign.name}`)

    return (await this.db.getCampaignById(campaignId))!
  }

  /**
   * Pausa una campaña
   */
  async pauseCampaign(campaignId: number): Promise<Campaign> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    if (campaign.status !== 'running') {
      throw new Error(`Cannot pause campaign in status: ${campaign.status}`)
    }

    await this.db.updateCampaignStatus(campaignId, 'paused')

    await this.db.createLog(campaignId, 'paused', {
      sent_count: campaign.sent_count,
      failed_count: campaign.failed_count
    })

    this.bp.logger.forBot(campaign.bot_id).info(`[outbound-campaigns] Campaign paused: ${campaign.name}`)

    return (await this.db.getCampaignById(campaignId))!
  }

  /**
   * Reanuda una campaña pausada
   */
  async resumeCampaign(campaignId: number): Promise<Campaign> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      throw new Error('Campaign not found')
    }

    if (campaign.status !== 'paused') {
      throw new Error(`Cannot resume campaign in status: ${campaign.status}`)
    }

    await this.db.updateCampaignStatus(campaignId, 'running')

    await this.db.createLog(campaignId, 'resumed', {
      pending_recipients: campaign.total_recipients - campaign.sent_count - campaign.failed_count
    })

    this.bp.logger.forBot(campaign.bot_id).info(`[outbound-campaigns] Campaign resumed: ${campaign.name}`)

    return (await this.db.getCampaignById(campaignId))!
  }

  // ==================== REPORTS ====================

  /**
   * Obtiene el reporte de una campaña
   */
  async getCampaignReport(campaignId: number): Promise<CampaignReport | null> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) {
      return null
    }

    const counts = await this.db.countRecipientsByStatus(campaignId)
    const logs = await this.db.getLogsByCampaign(campaignId, 50)

    const progress = campaign.total_recipients > 0
      ? Math.round(((counts.sent + counts.failed) / campaign.total_recipients) * 100)
      : 0

    return {
      campaign,
      metrics: {
        total: counts.total,
        pending: counts.pending,
        processing: counts.processing,
        sent: counts.sent,
        failed: counts.failed,
        progress_percentage: progress
      },
      logs
    }
  }

  /**
   * Obtiene destinatarios fallidos para exportación
   */
  async getFailedRecipients(campaignId: number): Promise<Recipient[]> {
    return this.db.getFailedRecipients(campaignId)
  }

  // ==================== DAEMON HELPERS ====================

  /**
   * Obtiene campañas en ejecución
   */
  async getRunningCampaigns(): Promise<Campaign[]> {
    return this.db.getRunningCampaigns()
  }

  /**
   * Obtiene el siguiente lote de destinatarios a procesar
   */
  async getNextBatch(campaignId: number, batchSize: number): Promise<Recipient[]> {
    return this.db.getPendingRecipients(campaignId, batchSize)
  }

  /**
   * Marca destinatarios como en procesamiento
   */
  async markAsProcessing(recipientIds: number[]): Promise<void> {
    return this.db.markRecipientsAsProcessing(recipientIds)
  }

  /**
   * Procesa el envío de un mensaje a un destinatario
   */
  async sendMessage(
    campaign: Campaign,
    recipient: Recipient
  ): Promise<{ success: boolean; messageUuid?: string; error?: string }> {
    const result = await sendWhatsAppTemplate(
      this.bp,
      campaign.bot_id,
      recipient.phone_number,
      campaign.template_id,
      recipient.variables,
      campaign.template_namespace,
      campaign.template_language || 'es-MX'
    )

    if (result.success) {
      await this.db.updateRecipientStatus(recipient.id, 'sent', result.message_uuid)
      await this.db.incrementSentCount(campaign.id)
      await this.db.createLog(campaign.id, 'message_sent', {
        phone_number: recipient.phone_number,
        message_uuid: result.message_uuid
      }, recipient.id)
    } else {
      await this.db.incrementRetryCount(recipient.id)
      await this.db.updateRecipientStatus(recipient.id, 'failed', undefined, result.error)
      await this.db.incrementFailedCount(campaign.id)
      await this.db.createLog(campaign.id, 'message_failed', {
        phone_number: recipient.phone_number,
        error: result.error
      }, recipient.id)
    }

    return result
  }

  /**
   * Actualiza timestamp del último batch
   */
  async updateLastBatchAt(campaignId: number): Promise<void> {
    return this.db.updateLastBatchAt(campaignId)
  }

  /**
   * Verifica si hay destinatarios pendientes
   */
  async hasPendingRecipients(campaignId: number): Promise<boolean> {
    return this.db.hasPendingRecipients(campaignId)
  }

  /**
   * Marca una campaña como completada
   */
  async completeCampaign(campaignId: number): Promise<void> {
    const campaign = await this.db.getCampaignById(campaignId)
    if (!campaign) return

    await this.db.updateCampaignStatus(campaignId, 'completed')
    await this.db.createLog(campaignId, 'completed', {
      sent_count: campaign.sent_count,
      failed_count: campaign.failed_count,
      total_recipients: campaign.total_recipients
    })

    this.bp.logger.forBot(campaign.bot_id).info(
      `[outbound-campaigns] Campaign completed: ${campaign.name} - ` +
      `Sent: ${campaign.sent_count}, Failed: ${campaign.failed_count}`
    )
  }
}
