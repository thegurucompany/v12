import * as sdk from 'botpress/sdk'
import _ from 'lodash'
import ms from 'ms'

import { OutboundCampaignsService } from './service'
import { Campaign } from './types'

// Intervalo de revisión del daemon (cada 5 segundos)
const DAEMON_INTERVAL_MS = 5000

// Referencia al intervalo para poder detenerlo
let daemonInterval: NodeJS.Timeout | null = null
let bp: typeof sdk
let service: OutboundCampaignsService

/**
 * Inicia el daemon de procesamiento de campañas
 */
export function startDaemon(bpInstance: typeof sdk, serviceInstance: OutboundCampaignsService): void {
  bp = bpInstance
  service = serviceInstance

  if (daemonInterval) {
    clearInterval(daemonInterval)
  }

  daemonInterval = setInterval(processCampaigns, DAEMON_INTERVAL_MS)
  bp.logger.info('[outbound-campaigns] Daemon started')
}

/**
 * Detiene el daemon
 */
export function stopDaemon(): void {
  if (daemonInterval) {
    clearInterval(daemonInterval)
    daemonInterval = null
    bp?.logger.info('[outbound-campaigns] Daemon stopped')
  }
}

/**
 * Función principal del daemon que procesa campañas activas
 */
async function processCampaigns(): Promise<void> {
  try {
    // Obtener campañas en ejecución
    const runningCampaigns = await service.getRunningCampaigns()

    if (runningCampaigns.length === 0) {
      return
    }

    // Procesar cada campaña
    for (const campaign of runningCampaigns) {
      await processCampaign(campaign)
    }
  } catch (error) {
    bp.logger.error(`[outbound-campaigns] Daemon error: ${error.message}`)
  }
}

/**
 * Procesa una campaña individual
 */
async function processCampaign(campaign: Campaign): Promise<void> {
  try {
    // Adquirir lock distribuido para esta campaña
    const lockKey = `outbound-campaigns/lock/${campaign.id}`
    const lock = await bp.distributed.acquireLock(lockKey, ms('2m'))

    if (!lock) {
      // Otra instancia está procesando esta campaña
      return
    }

    try {
      // Verificar si ya pasó el intervalo desde el último batch
      const now = Date.now()
      const lastBatchAt = campaign.last_batch_at ? new Date(campaign.last_batch_at).getTime() : 0
      const elapsed = now - lastBatchAt

      if (elapsed < campaign.batch_interval_ms) {
        // Aún no es tiempo de procesar el siguiente batch
        return
      }

      // Verificar si hay destinatarios pendientes
      const hasPending = await service.hasPendingRecipients(campaign.id)

      if (!hasPending) {
        // No hay más destinatarios, completar campaña
        await service.completeCampaign(campaign.id)
        return
      }

      // Obtener siguiente lote de destinatarios
      const recipients = await service.getNextBatch(campaign.id, campaign.batch_size)

      if (recipients.length === 0) {
        // No hay destinatarios pendientes
        await service.completeCampaign(campaign.id)
        return
      }

      // Marcar como processing
      const recipientIds = recipients.map(r => r.id)
      await service.markAsProcessing(recipientIds)

      bp.logger.forBot(campaign.bot_id).info(
        `[outbound-campaigns] Processing batch of ${recipients.length} messages for campaign ${campaign.id}`
      )

      // Enviar mensajes secuencialmente para respetar rate limits
      let successCount = 0
      let failCount = 0

      for (const recipient of recipients) {
        try {
          const result = await service.sendMessage(campaign, recipient)
          if (result.success) {
            successCount++
          } else {
            failCount++
          }
        } catch (error) {
          failCount++
          bp.logger.forBot(campaign.bot_id).warn(
            `[outbound-campaigns] Error sending to ${recipient.phone_number}: ${error.message}`
          )
        }
      }

      // Actualizar timestamp del último batch
      await service.updateLastBatchAt(campaign.id)

      bp.logger.forBot(campaign.bot_id).info(
        `[outbound-campaigns] Batch completed for campaign ${campaign.id}: ` +
        `${successCount} sent, ${failCount} failed`
      )

      // Verificar si quedan pendientes después de este batch
      const stillHasPending = await service.hasPendingRecipients(campaign.id)
      if (!stillHasPending) {
        await service.completeCampaign(campaign.id)
      }
    } finally {
      await lock.unlock()
    }
  } catch (error) {
    bp.logger.forBot(campaign.bot_id).error(
      `[outbound-campaigns] Error processing campaign ${campaign.id}: ${error.message}`
    )
  }
}
