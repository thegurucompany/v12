import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import {
  Campaign,
  CampaignRow,
  CampaignStatus,
  Recipient,
  RecipientRow,
  RecipientStatus,
  CampaignLog,
  CampaignLogRow,
  LogEventType,
  CreateCampaignInput,
  UpdateCampaignInput
} from './types'

export default class OutboundCampaignsDb {
  knex: sdk.KnexExtended

  constructor(bp: typeof sdk) {
    this.knex = bp.database
  }

  /**
   * Inicializa las tablas del módulo si no existen
   */
  async initialize(): Promise<void> {
    // Verificar si la tabla existe pero tiene estructura incorrecta
    const tableExists = await this.knex.schema.hasTable('outbound_campaigns')
    if (tableExists) {
      // Verificar si la columna id es autoincrement
      try {
        // Intentar insertar y eliminar un registro de prueba
        const testResult = await this.knex('outbound_campaigns')
          .insert({
            bot_id: '__test__',
            name: '__test__',
            template_id: '__test__',
            status: 'draft'
          })
          .returning('id')
        
        if (testResult && testResult[0]) {
          // Eliminar el registro de prueba
          const id = typeof testResult[0] === 'object' ? testResult[0].id : testResult[0]
          await this.knex('outbound_campaigns').where({ id }).delete()
        }
      } catch (error: any) {
        // Si hay error de constraint en id, la tabla tiene estructura incorrecta
        if (error.message && error.message.includes('null value in column "id"')) {
          console.log('[outbound-campaigns] Detected corrupted table structure, recreating tables...')
          // Usar CASCADE para eliminar todas las dependencias
          await this.knex.raw('DROP TABLE IF EXISTS outbound_campaign_logs CASCADE')
          await this.knex.raw('DROP TABLE IF EXISTS outbound_campaign_recipients CASCADE')
          await this.knex.raw('DROP TABLE IF EXISTS outbound_campaigns CASCADE')
        }
      }
    }

    // Tabla principal de campañas
    await this.knex.createTableIfNotExists('outbound_campaigns', table => {
      table.increments('id').primary()
      table.string('bot_id').notNullable().index()
      table.string('name').notNullable()
      table.string('template_id').notNullable()
      table.string('template_namespace')
      table.string('template_language').defaultTo('es-MX')
      table.string('status').notNullable().defaultTo('draft').index()
      table.integer('batch_size').notNullable().defaultTo(100)
      table.integer('batch_interval_ms').notNullable().defaultTo(60000)
      table.integer('total_recipients').notNullable().defaultTo(0)
      table.integer('sent_count').notNullable().defaultTo(0)
      table.integer('failed_count').notNullable().defaultTo(0)
      table.timestamp('last_batch_at')
      table.timestamp('created_at').notNullable().defaultTo(this.knex.fn.now())
      table.timestamp('updated_at').notNullable().defaultTo(this.knex.fn.now())
      table.timestamp('started_at')
      table.timestamp('completed_at')
    })

    // Tabla de destinatarios
    await this.knex.createTableIfNotExists('outbound_campaign_recipients', table => {
      table.increments('id').primary()
      table
        .integer('campaign_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('outbound_campaigns')
        .onDelete('CASCADE')
      table.string('phone_number').notNullable()
      table.text('variables').notNullable().defaultTo('{}')
      table.string('status').notNullable().defaultTo('pending').index()
      table.integer('retry_count').notNullable().defaultTo(0)
      table.text('error_message')
      table.string('message_uuid')
      table.timestamp('sent_at')
      table.timestamp('created_at').notNullable().defaultTo(this.knex.fn.now())

      // Índice compuesto para búsqueda eficiente de destinatarios pendientes por campaña
      table.index(['campaign_id', 'status'])
    })

    // Tabla de logs de auditoría
    await this.knex.createTableIfNotExists('outbound_campaign_logs', table => {
      table.increments('id').primary()
      table
        .integer('campaign_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('outbound_campaigns')
        .onDelete('CASCADE')
      table
        .integer('recipient_id')
        .unsigned()
        .references('id')
        .inTable('outbound_campaign_recipients')
        .onDelete('SET NULL')
      table.string('event_type').notNullable().index()
      table.text('event_data').notNullable().defaultTo('{}')
      table.timestamp('created_at').notNullable().defaultTo(this.knex.fn.now())

      // Índice para búsqueda de logs por campaña
      table.index(['campaign_id', 'created_at'])
    })

    // Migración: añadir columnas faltantes (para tablas creadas anteriormente)
    await this.migrateSchema()
  }

  /**
   * Migración para añadir columnas faltantes a tablas existentes
   */
  private async migrateSchema(): Promise<void> {
    const tableName = 'outbound_campaigns'
    
    // Lista de columnas que deben existir con sus definiciones
    const columnsToCheck = [
      { name: 'bot_id', add: (table: any) => table.string('bot_id').notNullable().defaultTo('default').index() },
      { name: 'name', add: (table: any) => table.string('name').notNullable().defaultTo('') },
      { name: 'template_id', add: (table: any) => table.string('template_id').notNullable().defaultTo('') },
      { name: 'template_namespace', add: (table: any) => table.string('template_namespace') },
      { name: 'template_language', add: (table: any) => table.string('template_language').defaultTo('es-MX') },
      { name: 'status', add: (table: any) => table.string('status').notNullable().defaultTo('draft').index() },
      { name: 'batch_size', add: (table: any) => table.integer('batch_size').notNullable().defaultTo(100) },
      { name: 'batch_interval_ms', add: (table: any) => table.integer('batch_interval_ms').notNullable().defaultTo(60000) },
      { name: 'total_recipients', add: (table: any) => table.integer('total_recipients').notNullable().defaultTo(0) },
      { name: 'sent_count', add: (table: any) => table.integer('sent_count').notNullable().defaultTo(0) },
      { name: 'failed_count', add: (table: any) => table.integer('failed_count').notNullable().defaultTo(0) },
      { name: 'last_batch_at', add: (table: any) => table.timestamp('last_batch_at') },
      { name: 'created_at', add: (table: any) => table.timestamp('created_at').notNullable().defaultTo(this.knex.fn.now()) },
      { name: 'updated_at', add: (table: any) => table.timestamp('updated_at').notNullable().defaultTo(this.knex.fn.now()) },
      { name: 'started_at', add: (table: any) => table.timestamp('started_at') },
      { name: 'completed_at', add: (table: any) => table.timestamp('completed_at') },
    ]

    for (const col of columnsToCheck) {
      const hasColumn = await this.knex.schema.hasColumn(tableName, col.name)
      if (!hasColumn) {
        await this.knex.schema.alterTable(tableName, col.add)
      }
    }
  }

  // ==================== CAMPAIGNS ====================

  /**
   * Crea una nueva campaña
   */
  async createCampaign(botId: string, input: CreateCampaignInput): Promise<Campaign> {
    const row: Partial<CampaignRow> = {
      bot_id: botId,
      name: input.name,
      template_id: input.template_id,
      template_namespace: input.template_namespace,
      template_language: input.template_language || 'es-MX',
      status: 'draft',
      batch_size: input.batch_size || 100,
      batch_interval_ms: input.batch_interval_ms || 60000,
      total_recipients: 0,
      sent_count: 0,
      failed_count: 0
    }

    const [id] = await this.knex('outbound_campaigns').insert(row).returning('id')
    const insertedId = typeof id === 'object' ? id.id : id

    return this.getCampaignById(insertedId)
  }

  /**
   * Obtiene una campaña por ID
   */
  async getCampaignById(id: number): Promise<Campaign | null> {
    const row = await this.knex('outbound_campaigns').where({ id }).first()
    return row ? this.mapCampaignRowToModel(row) : null
  }

  /**
   * Obtiene todas las campañas de un bot
   */
  async getCampaignsByBotId(botId: string): Promise<Campaign[]> {
    const rows = await this.knex('outbound_campaigns')
      .where({ bot_id: botId })
      .orderBy('created_at', 'desc')

    return rows.map(row => this.mapCampaignRowToModel(row))
  }

  /**
   * Actualiza una campaña
   */
  async updateCampaign(id: number, input: UpdateCampaignInput): Promise<Campaign | null> {
    const updates: Partial<CampaignRow> = {
      updated_at: this.knex.fn.now() as any
    }

    if (input.name !== undefined) updates.name = input.name
    if (input.template_id !== undefined) updates.template_id = input.template_id
    if (input.template_namespace !== undefined) updates.template_namespace = input.template_namespace
    if (input.template_language !== undefined) updates.template_language = input.template_language
    if (input.batch_size !== undefined) updates.batch_size = input.batch_size
    if (input.batch_interval_ms !== undefined) updates.batch_interval_ms = input.batch_interval_ms

    await this.knex('outbound_campaigns').where({ id }).update(updates)

    return this.getCampaignById(id)
  }

  /**
   * Elimina una campaña y todos sus destinatarios/logs (cascade)
   */
  async deleteCampaign(id: number): Promise<void> {
    await this.knex('outbound_campaigns').where({ id }).del()
  }

  /**
   * Actualiza el estado de una campaña
   */
  async updateCampaignStatus(id: number, status: CampaignStatus): Promise<void> {
    const updates: Partial<CampaignRow> = {
      status,
      updated_at: this.knex.fn.now() as any
    }

    if (status === 'running') {
      updates.started_at = this.knex.fn.now() as any
    } else if (status === 'completed' || status === 'failed') {
      updates.completed_at = this.knex.fn.now() as any
    }

    await this.knex('outbound_campaigns').where({ id }).update(updates)
  }

  /**
   * Obtiene campañas activas (status = running)
   */
  async getRunningCampaigns(): Promise<Campaign[]> {
    const rows = await this.knex('outbound_campaigns').where({ status: 'running' })
    return rows.map(row => this.mapCampaignRowToModel(row))
  }

  /**
   * Actualiza el timestamp del último batch
   */
  async updateLastBatchAt(id: number): Promise<void> {
    await this.knex('outbound_campaigns')
      .where({ id })
      .update({ last_batch_at: this.knex.fn.now() })
  }

  /**
   * Incrementa contadores de envío
   */
  async incrementSentCount(id: number): Promise<void> {
    await this.knex('outbound_campaigns')
      .where({ id })
      .increment('sent_count', 1)
  }

  async incrementFailedCount(id: number): Promise<void> {
    await this.knex('outbound_campaigns')
      .where({ id })
      .increment('failed_count', 1)
  }

  async updateTotalRecipients(id: number, count: number): Promise<void> {
    await this.knex('outbound_campaigns')
      .where({ id })
      .update({ total_recipients: count })
  }

  // ==================== RECIPIENTS ====================

  /**
   * Inserta destinatarios en lotes
   */
  async insertRecipientsBatch(campaignId: number, recipients: Array<{ phone_number: string; variables: Record<string, string> }>): Promise<void> {
    const rows: Partial<RecipientRow>[] = recipients.map(r => ({
      campaign_id: campaignId,
      phone_number: r.phone_number,
      variables: JSON.stringify(r.variables),
      status: 'pending',
      retry_count: 0
    }))

    // Insertar en chunks de 1000
    const chunks = _.chunk(rows, 1000)
    for (const chunk of chunks) {
      await this.knex('outbound_campaign_recipients').insert(chunk)
    }
  }

  /**
   * Obtiene destinatarios pendientes de una campaña
   */
  async getPendingRecipients(campaignId: number, limit: number): Promise<Recipient[]> {
    const rows = await this.knex('outbound_campaign_recipients')
      .where({ campaign_id: campaignId, status: 'pending' })
      .limit(limit)
      .orderBy('id', 'asc')

    return rows.map(row => this.mapRecipientRowToModel(row))
  }

  /**
   * Marca destinatarios como "processing"
   */
  async markRecipientsAsProcessing(ids: number[]): Promise<void> {
    await this.knex('outbound_campaign_recipients')
      .whereIn('id', ids)
      .update({ status: 'processing' })
  }

  /**
   * Actualiza el estado de un destinatario después del envío
   */
  async updateRecipientStatus(
    id: number,
    status: RecipientStatus,
    messageUuid?: string,
    errorMessage?: string
  ): Promise<void> {
    const updates: Partial<RecipientRow> = { status }

    if (status === 'sent') {
      updates.sent_at = this.knex.fn.now() as any
      updates.message_uuid = messageUuid
    } else if (status === 'failed') {
      updates.error_message = errorMessage
    }

    await this.knex('outbound_campaign_recipients').where({ id }).update(updates)
  }

  /**
   * Incrementa el contador de reintentos
   */
  async incrementRetryCount(id: number): Promise<void> {
    await this.knex('outbound_campaign_recipients')
      .where({ id })
      .increment('retry_count', 1)
  }

  /**
   * Cuenta destinatarios por estado
   */
  async countRecipientsByStatus(campaignId: number): Promise<Record<RecipientStatus | 'total', number>> {
    const rows = await this.knex('outbound_campaign_recipients')
      .where({ campaign_id: campaignId })
      .select('status')
      .count('* as count')
      .groupBy('status')

    const result: Record<RecipientStatus | 'total', number> = {
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      total: 0
    }

    for (const row of rows) {
      result[row.status as RecipientStatus] = parseInt(row.count as string, 10)
      result.total += parseInt(row.count as string, 10)
    }

    return result
  }

  /**
   * Obtiene destinatarios fallidos para exportación
   */
  async getFailedRecipients(campaignId: number): Promise<Recipient[]> {
    const rows = await this.knex('outbound_campaign_recipients')
      .where({ campaign_id: campaignId, status: 'failed' })
      .orderBy('id', 'asc')

    return rows.map(row => this.mapRecipientRowToModel(row))
  }

  /**
   * Elimina todos los destinatarios de una campaña
   */
  async deleteRecipientsByCampaign(campaignId: number): Promise<void> {
    await this.knex('outbound_campaign_recipients').where({ campaign_id: campaignId }).del()
  }

  /**
   * Verifica si hay destinatarios pendientes
   */
  async hasPendingRecipients(campaignId: number): Promise<boolean> {
    const result = await this.knex('outbound_campaign_recipients')
      .where({ campaign_id: campaignId })
      .whereIn('status', ['pending', 'processing'])
      .count('* as count')
      .first()

    return parseInt(result?.count as string || '0', 10) > 0
  }

  // ==================== LOGS ====================

  /**
   * Registra un evento de log
   */
  async createLog(campaignId: number, eventType: LogEventType, eventData: Record<string, any>, recipientId?: number): Promise<void> {
    const row: Partial<CampaignLogRow> = {
      campaign_id: campaignId,
      recipient_id: recipientId,
      event_type: eventType,
      event_data: JSON.stringify(eventData)
    }

    await this.knex('outbound_campaign_logs').insert(row)
  }

  /**
   * Obtiene logs de una campaña
   */
  async getLogsByCampaign(campaignId: number, limit: number = 100): Promise<CampaignLog[]> {
    const rows = await this.knex('outbound_campaign_logs')
      .where({ campaign_id: campaignId })
      .orderBy('created_at', 'desc')
      .limit(limit)

    return rows.map(row => this.mapLogRowToModel(row))
  }

  // ==================== BULK SEND HISTORY ====================

  /**
   * Obtiene el historial de envíos masivos filtrado por bot y rango de fechas
   */
  async getBulkSendHistory(
    botId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<Array<{
    campaign_id: number
    campaign_name: string
    recipient_id: number
    phone_number: string
    status: string
    message_uuid: string | undefined
    sent_at: Date | undefined
    error_message: string | undefined
    retry_count: number
    variables: Record<string, any>
  }>> {
    const rows = await this.knex('outbound_campaign_recipients as r')
      .innerJoin('outbound_campaigns as c', 'r.campaign_id', 'c.id')
      .select(
        'c.id as campaign_id',
        'c.name as campaign_name',
        'r.id as recipient_id',
        'r.phone_number',
        'r.status',
        'r.message_uuid',
        'r.sent_at',
        'r.error_message',
        'r.retry_count',
        'r.variables',
        'r.created_at'
      )
      .where('c.bot_id', botId)
      .where(function() {
        this.whereBetween('c.created_at', [startDate, endDate])
          .orWhereBetween('r.created_at', [startDate, endDate])
      })
      .orderBy('r.created_at', 'desc')
      .orderBy('r.id', 'desc')

    return rows.map(row => ({
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      recipient_id: row.recipient_id,
      phone_number: row.phone_number,
      status: row.status,
      message_uuid: row.message_uuid,
      sent_at: row.sent_at ? new Date(row.sent_at) : undefined,
      error_message: row.error_message,
      retry_count: row.retry_count,
      variables: JSON.parse(row.variables || '{}')
    }))
  }

  /**
   * Obtiene estadísticas por campaña para un período
   */
  async getCampaignStatsForPeriod(
    botId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{
    id: number
    name: string
    total: number
    sent: number
    failed: number
    pending: number
  }>> {
    const rows = await this.knex('outbound_campaigns as c')
      .leftJoin('outbound_campaign_recipients as r', 'c.id', 'r.campaign_id')
      .select('c.id', 'c.name')
      .count('r.id as total')
      .sum(this.knex.raw("CASE WHEN r.status = 'sent' THEN 1 ELSE 0 END")).as('sent')
      .sum(this.knex.raw("CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END")).as('failed')
      .sum(this.knex.raw("CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END")).as('pending')
      .where('c.bot_id', botId)
      .where(function() {
        this.whereBetween('c.created_at', [startDate, endDate])
          .orWhere(function() {
            this.whereNotNull('r.id')
              .whereBetween('r.created_at', [startDate, endDate])
          })
      })
      .groupBy('c.id', 'c.name')
      .havingRaw('COUNT(r.id) > 0')
      .orderBy('c.name')

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      total: parseInt(row.total as string) || 0,
      sent: parseInt(row.sent as string) || 0,
      failed: parseInt(row.failed as string) || 0,
      pending: parseInt(row.pending as string) || 0
    }))
  }

  // ==================== MAPPERS ====================

  private mapCampaignRowToModel(row: CampaignRow): Campaign {
    return {
      id: row.id!,
      bot_id: row.bot_id,
      name: row.name,
      template_id: row.template_id,
      template_namespace: row.template_namespace,
      template_language: row.template_language,
      status: row.status,
      batch_size: row.batch_size,
      batch_interval_ms: row.batch_interval_ms,
      total_recipients: row.total_recipients,
      sent_count: row.sent_count,
      failed_count: row.failed_count,
      last_batch_at: row.last_batch_at ? new Date(row.last_batch_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      started_at: row.started_at ? new Date(row.started_at) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at) : undefined
    }
  }

  private mapRecipientRowToModel(row: RecipientRow): Recipient {
    return {
      id: row.id!,
      campaign_id: row.campaign_id,
      phone_number: row.phone_number,
      variables: JSON.parse(row.variables || '{}'),
      status: row.status,
      retry_count: row.retry_count,
      error_message: row.error_message,
      message_uuid: row.message_uuid,
      sent_at: row.sent_at ? new Date(row.sent_at) : undefined,
      created_at: new Date(row.created_at)
    }
  }

  private mapLogRowToModel(row: CampaignLogRow): CampaignLog {
    return {
      id: row.id!,
      campaign_id: row.campaign_id,
      recipient_id: row.recipient_id,
      event_type: row.event_type,
      event_data: JSON.parse(row.event_data || '{}'),
      created_at: new Date(row.created_at)
    }
  }
}
