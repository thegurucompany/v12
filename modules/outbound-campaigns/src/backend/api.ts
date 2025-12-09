import * as sdk from 'botpress/sdk'
import Joi from 'joi'
import _ from 'lodash'
import multer from 'multer'

import { OutboundCampaignsService } from './service'
import { CreateCampaignInput, UpdateCampaignInput } from './types'

// Configurar multer para archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB máximo
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV files are allowed'))
    }
  }
})

// Schemas de validación
const createCampaignSchema = Joi.object({
  name: Joi.string().required().min(1).max(255),
  template_id: Joi.string().required().min(1).max(255),
  template_namespace: Joi.string().optional().max(255),
  template_language: Joi.string().optional().max(10).default('es-MX'),
  batch_size: Joi.number().optional().min(1).max(1000).default(100),
  batch_interval_ms: Joi.number().optional().min(1000).max(3600000).default(60000)
})

const updateCampaignSchema = Joi.object({
  name: Joi.string().optional().min(1).max(255),
  template_id: Joi.string().optional().min(1).max(255),
  template_namespace: Joi.string().optional().max(255),
  template_language: Joi.string().optional().max(10),
  batch_size: Joi.number().optional().min(1).max(1000),
  batch_interval_ms: Joi.number().optional().min(1000).max(3600000)
})

export function setupApi(bp: typeof sdk, service: OutboundCampaignsService) {
  const router = bp.http.createRouterForBot('outbound-campaigns')

  // Middleware para verificar que Vonage está configurado
  const checkVonageMiddleware = async (req: any, res: any, next: any) => {
    try {
      const botId = req.params.botId
      const isConfigured = await service.isVonageConfigured(botId)
      if (!isConfigured) {
        return res.status(403).json({
          success: false,
          error: 'Vonage is not configured for this bot'
        })
      }
      next()
    } catch (error) {
      next(error)
    }
  }

  // ==================== STATUS ====================

  /**
   * GET /status
   * Retorna si el módulo está habilitado para este bot
   */
  router.get('/status', async (req, res) => {
    try {
      const botId = req.params.botId
      const enabled = await service.isVonageConfigured(botId)
      res.json({ success: true, enabled })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in GET /status: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // ==================== CAMPAIGNS CRUD ====================

  /**
   * GET /campaigns
   * Lista todas las campañas del bot
   */
  router.get('/campaigns', checkVonageMiddleware, async (req, res) => {
    try {
      const botId = req.params.botId
      const campaigns = await service.getCampaigns(botId)
      res.json({ success: true, campaigns })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in GET /campaigns: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  /**
   * POST /campaigns
   * Crea una nueva campaña
   */
  router.post('/campaigns', checkVonageMiddleware, async (req, res) => {
    try {
      const botId = req.params.botId
      const { error, value } = createCampaignSchema.validate(req.body)

      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        })
      }

      const input: CreateCampaignInput = value
      const campaign = await service.createCampaign(botId, input)

      res.status(201).json({ success: true, campaign })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in POST /campaigns: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  /**
   * GET /campaigns/:id
   * Obtiene el detalle de una campaña
   */
  router.get('/campaigns/:id', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const campaign = await service.getCampaign(campaignId)
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' })
      }

      res.json({ success: true, campaign })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in GET /campaigns/:id: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  /**
   * PUT /campaigns/:id
   * Actualiza una campaña (solo en estado draft)
   */
  router.put('/campaigns/:id', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const { error, value } = updateCampaignSchema.validate(req.body)
      if (error) {
        return res.status(400).json({
          success: false,
          error: error.details[0].message
        })
      }

      const input: UpdateCampaignInput = value
      const campaign = await service.updateCampaign(campaignId, input)

      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' })
      }

      res.json({ success: true, campaign })
    } catch (error) {
      if (error.message.includes('Cannot modify')) {
        return res.status(400).json({ success: false, error: error.message })
      }
      bp.logger.error(`[outbound-campaigns] Error in PUT /campaigns/:id: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  /**
   * DELETE /campaigns/:id
   * Elimina una campaña
   */
  router.delete('/campaigns/:id', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      await service.deleteCampaign(campaignId)
      res.json({ success: true, message: 'Campaign deleted' })
    } catch (error) {
      if (error.message.includes('not found') || error.message.includes('Cannot delete')) {
        return res.status(400).json({ success: false, error: error.message })
      }
      bp.logger.error(`[outbound-campaigns] Error in DELETE /campaigns/:id: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // ==================== CSV UPLOAD ====================

  /**
   * POST /campaigns/:id/upload-csv
   * Sube un archivo CSV con destinatarios
   */
  router.post('/campaigns/:id/upload-csv', checkVonageMiddleware, upload.single('file') as any, async (req: any, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const file = req.file as Express.Multer.File
      if (!file) {
        return res.status(400).json({ success: false, error: 'No file uploaded' })
      }

      const result = await service.processCSV(campaignId, file.buffer)
      res.json({ success: true, result })
    } catch (error) {
      if (error.message.includes('not found') || error.message.includes('draft')) {
        return res.status(400).json({ success: false, error: error.message })
      }
      bp.logger.error(`[outbound-campaigns] Error in POST /campaigns/:id/upload-csv: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  // ==================== CAMPAIGN ACTIONS ====================

  /**
   * POST /campaigns/:id/start
   * Inicia una campaña
   */
  router.post('/campaigns/:id/start', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const campaign = await service.startCampaign(campaignId)
      res.json({ success: true, campaign })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in POST /campaigns/:id/start: ${error.message}`)
      res.status(400).json({ success: false, error: error.message })
    }
  })

  /**
   * POST /campaigns/:id/pause
   * Pausa una campaña
   */
  router.post('/campaigns/:id/pause', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const campaign = await service.pauseCampaign(campaignId)
      res.json({ success: true, campaign })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in POST /campaigns/:id/pause: ${error.message}`)
      res.status(400).json({ success: false, error: error.message })
    }
  })

  /**
   * POST /campaigns/:id/resume
   * Reanuda una campaña pausada
   */
  router.post('/campaigns/:id/resume', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const campaign = await service.resumeCampaign(campaignId)
      res.json({ success: true, campaign })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in POST /campaigns/:id/resume: ${error.message}`)
      res.status(400).json({ success: false, error: error.message })
    }
  })

  // ==================== REPORTS ====================

  /**
   * GET /campaigns/:id/report
   * Obtiene el reporte de una campaña
   */
  router.get('/campaigns/:id/report', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const report = await service.getCampaignReport(campaignId)
      if (!report) {
        return res.status(404).json({ success: false, error: 'Campaign not found' })
      }

      res.json({ success: true, report })
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in GET /campaigns/:id/report: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })

  /**
   * GET /campaigns/:id/export-failed
   * Exporta destinatarios fallidos como CSV
   */
  router.get('/campaigns/:id/export-failed', checkVonageMiddleware, async (req, res) => {
    try {
      const campaignId = parseInt(req.params.id, 10)
      if (isNaN(campaignId)) {
        return res.status(400).json({ success: false, error: 'Invalid campaign ID' })
      }

      const failedRecipients = await service.getFailedRecipients(campaignId)

      // Generar CSV con más detalles
      const csvLines = ['phone_number,status,retry_count,error_message,error_type,error_detail,variables,sent_at,created_at']
      for (const recipient of failedRecipients) {
        const escapedError = (recipient.error_message || '').replace(/"/g, '""')
        const escapedVars = JSON.stringify(recipient.variables).replace(/"/g, '""')
        
        // Intentar parsear el error para extraer más detalles
        let errorType = ''
        let errorDetail = ''
        if (recipient.error_message) {
          // El formato es: "HTTP XXX | Type: xxx | Title: xxx | Detail: xxx"
          const parts = recipient.error_message.split(' | ')
          for (const part of parts) {
            if (part.startsWith('Type:')) {
              errorType = part.replace('Type:', '').trim()
            } else if (part.startsWith('Detail:')) {
              errorDetail = part.replace('Detail:', '').trim()
            }
          }
        }
        
        const sentAt = recipient.sent_at ? new Date(recipient.sent_at).toISOString() : ''
        const createdAt = recipient.created_at ? new Date(recipient.created_at).toISOString() : ''
        
        csvLines.push(`${recipient.phone_number},${recipient.status},${recipient.retry_count},"${escapedError}","${errorType}","${errorDetail}","${escapedVars}",${sentAt},${createdAt}`)
      }

      const csvContent = csvLines.join('\n')

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="failed_recipients_${campaignId}.csv"`)
      res.send(csvContent)
    } catch (error) {
      bp.logger.error(`[outbound-campaigns] Error in GET /campaigns/:id/export-failed: ${error.message}`)
      res.status(500).json({ success: false, error: error.message })
    }
  })
}
