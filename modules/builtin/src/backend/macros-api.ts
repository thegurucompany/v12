import * as sdk from 'botpress/sdk'
import { asyncMiddleware as asyncMw, BPRequest } from 'common/http'
import { Response } from 'express'
import Joi from 'joi'

import MacrosRepository, { IMacro } from './macros-repository'

const macroSchema = Joi.object({
  name: Joi.string()
    .required()
    .max(255),
  content: Joi.string().required(),
  id: Joi.number().optional(),
  created_at: Joi.date().optional(),
  updated_at: Joi.date().optional()
}).unknown(false)

export default async (bp: typeof sdk, repository: MacrosRepository) => {
  const asyncMiddleware = asyncMw(bp.logger)
  const router = bp.http.createRouterForBot('builtin')

  // Middleware para verificar permisos de escritura (crear, editar, eliminar)
  const needWritePermission = async (req: BPRequest, res: Response, next) => {
    const hasPermission = await bp.http.hasPermission(req, 'write', 'module.builtin.macros', true)

    if (!hasPermission) {
      return res.status(403).json({
        error: 'No tienes permisos suficientes para realizar esta acción'
      })
    }

    next()
  }

  // Middleware para verificar permisos de lectura
  const needReadPermission = async (req: BPRequest, res: Response, next) => {
    const hasPermission = await bp.http.hasPermission(req, 'read', 'module.builtin.macros', true)

    if (!hasPermission) {
      return res.status(403).json({
        error: 'No tienes permisos suficientes para acceder a este recurso'
      })
    }

    next()
  }

  // GET /api/v1/bots/:botId/mod/builtin/macros - Get all macros for a bot
  router.get(
    '/macros',
    needReadPermission,
    asyncMiddleware(async (req: any, res: any) => {
      const botId = req.params.botId
      const macros = await repository.getMacrosByBot(botId)
      res.json(macros)
    })
  )

  // GET /api/v1/bots/:botId/mod/builtin/macros/:id - Get a specific macro
  router.get(
    '/macros/:id',
    needReadPermission,
    asyncMiddleware(async (req: any, res: any) => {
      const botId = req.params.botId
      const id = parseInt(req.params.id)
      const macro = await repository.getMacroById(id, botId)

      if (!macro) {
        return res.status(404).json({ error: 'Macro not found' })
      }

      res.json(macro)
    })
  )

  // POST /api/v1/bots/:botId/mod/builtin/macros - Create a new macro
  router.post(
    '/macros',
    needWritePermission,
    asyncMiddleware(async (req: any, res: any) => {
      const { error, value } = macroSchema.validate(req.body)

      if (error) {
        return res.status(400).json({ error: error.details[0].message })
      }

      const botId = req.params.botId
      const macro: IMacro = {
        botId,
        name: value.name,
        content: value.content
      }

      const created = await repository.createMacro(macro)
      res.status(201).json(created)
    })
  )

  // PUT /api/v1/bots/:botId/mod/builtin/macros/:id - Update a macro
  router.put(
    '/macros/:id',
    needWritePermission,
    asyncMiddleware(async (req: any, res: any) => {
      const { error, value } = macroSchema.validate(req.body)

      if (error) {
        return res.status(400).json({ error: error.details[0].message })
      }

      const botId = req.params.botId
      const id = parseInt(req.params.id)

      const updated = await repository.updateMacro(id, botId, {
        name: value.name,
        content: value.content
      })

      if (!updated) {
        return res.status(404).json({ error: 'Macro not found' })
      }

      const macro = await repository.getMacroById(id, botId)
      res.json(macro)
    })
  )

  // DELETE /api/v1/bots/:botId/mod/builtin/macros/:id - Delete a macro
  router.delete(
    '/macros/:id',
    needWritePermission,
    asyncMiddleware(async (req: any, res: any) => {
      const botId = req.params.botId
      const id = parseInt(req.params.id)

      const deleted = await repository.deleteMacro(id, botId)

      if (!deleted) {
        return res.status(404).json({ error: 'Macro not found' })
      }

      res.status(204).send()
    })
  )
}
