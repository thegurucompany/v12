import * as sdk from 'botpress/sdk'
import { RequestWithUser } from 'common/typings'
import { Response } from 'express'
import Joi from 'joi'

import { MODULE_NAME } from './constants'
import Repository from './repository'
import { CreateCategoryPayload, CreateTagPayload, UpdateCategoryPayload, UpdateTagPayload } from './types'

const CreateCategorySchema = Joi.object({
  name: Joi.string().required().max(255),
  description: Joi.string().optional().allow('', null),
  color: Joi.string().optional().max(7).allow('', null)
})

const UpdateCategorySchema = Joi.object({
  name: Joi.string().optional().max(255),
  description: Joi.string().optional().allow('', null),
  color: Joi.string().optional().max(7).allow('', null)
})

const CreateTagSchema = Joi.object({
  categoryId: Joi.number().required(),
  name: Joi.string().required().max(255),
  description: Joi.string().optional().allow('', null)
})

const UpdateTagSchema = Joi.object({
  name: Joi.string().optional().max(255),
  description: Joi.string().optional().allow('', null)
})

export default async (bp: typeof sdk, repository: Repository) => {
  const router = bp.http.createRouterForBot(MODULE_NAME)

  // Middleware to check if user is NOT an agent (can manage tags)
  const requireNonAgent = async (req: RequestWithUser, res: Response, next) => {
    try {
      const user = req.tokenUser
      if (!user) {
        return res.status(401).json({ message: 'Unauthorized' })
      }

      // Check if user has the 'agent' role - agents cannot manage tags
      const workspaceId = req.workspace
      if (!workspaceId) {
        return res.status(400).json({ message: 'Workspace not found' })
      }

      const workspaces = await bp.ghost.forGlobal().readFileAsObject<any[]>('/', 'workspaces.json')
      const workspace = workspaces.find(ws => ws.id === workspaceId)
      
      if (!workspace) {
        return res.status(400).json({ message: 'Workspace not found' })
      }

      const workspaceUser = workspace.users?.find(
        (u: any) => u.email === user.email && u.strategy === user.strategy
      )

      if (workspaceUser?.role === 'agent') {
        return res.status(403).json({ message: 'Agents cannot manage tags. Contact an administrator.' })
      }

      next()
    } catch (error) {
      bp.logger.error('Error in requireNonAgent middleware:', error)
      res.status(500).json({ message: 'Internal server error' })
    }
  }

  // Error handling middleware
  const errorMiddleware = fn => {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(err => {
        bp.logger.error('API Error:', err)
        res.status(500).json({ message: err.message || 'Internal server error' })
      })
    }
  }

  // ============ Categories ============

  // GET /categories - List all categories with their tags
  router.get(
    '/categories',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const categories = await repository.listCategories(req.params.botId)
      res.json(categories)
    })
  )

  // GET /categories/:id - Get a single category by ID
  router.get(
    '/categories/:id',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const category = await repository.getCategoryById(parseInt(req.params.id))
      if (!category) {
        return res.status(404).json({ message: 'Category not found' })
      }
      res.json(category)
    })
  )

  // POST /categories - Create a new category (non-agents only)
  router.post(
    '/categories',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const { error, value } = CreateCategorySchema.validate(req.body)
      if (error) {
        return res.status(400).json({ message: error.message })
      }

      const payload: CreateCategoryPayload = value
      const category = await repository.createCategory(req.params.botId, payload)
      res.status(201).json(category)
    })
  )

  // PUT /categories/:id - Update a category (non-agents only)
  router.put(
    '/categories/:id',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const { error, value } = UpdateCategorySchema.validate(req.body)
      if (error) {
        return res.status(400).json({ message: error.message })
      }

      const payload: UpdateCategoryPayload = value
      const category = await repository.updateCategory(parseInt(req.params.id), payload)
      
      if (!category) {
        return res.status(404).json({ message: 'Category not found' })
      }
      
      res.json(category)
    })
  )

  // DELETE /categories/:id - Delete a category (non-agents only)
  router.delete(
    '/categories/:id',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const deleted = await repository.deleteCategory(parseInt(req.params.id))
      
      if (!deleted) {
        return res.status(404).json({ message: 'Category not found' })
      }
      
      res.status(204).send()
    })
  )

  // ============ Tags ============

  // GET /tags/:id - Get a single tag by ID
  router.get(
    '/tags/:id',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const tag = await repository.getTagById(parseInt(req.params.id))
      if (!tag) {
        return res.status(404).json({ message: 'Tag not found' })
      }
      res.json(tag)
    })
  )

  // POST /tags - Create a new tag (non-agents only)
  router.post(
    '/tags',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const { error, value } = CreateTagSchema.validate(req.body)
      if (error) {
        return res.status(400).json({ message: error.message })
      }

      const payload: CreateTagPayload = value
      const tag = await repository.createTag(payload)
      res.status(201).json(tag)
    })
  )

  // PUT /tags/:id - Update a tag (non-agents only)
  router.put(
    '/tags/:id',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const { error, value } = UpdateTagSchema.validate(req.body)
      if (error) {
        return res.status(400).json({ message: error.message })
      }

      const payload: UpdateTagPayload = value
      const tag = await repository.updateTag(parseInt(req.params.id), payload)
      
      if (!tag) {
        return res.status(404).json({ message: 'Tag not found' })
      }
      
      res.json(tag)
    })
  )

  // DELETE /tags/:id - Delete a tag (non-agents only)
  router.delete(
    '/tags/:id',
    requireNonAgent,
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const deleted = await repository.deleteTag(parseInt(req.params.id))
      
      if (!deleted) {
        return res.status(404).json({ message: 'Tag not found' })
      }
      
      res.status(204).send()
    })
  )

  // ============ Handoff Tags (for HITL integration) ============

  // GET /handoffs/:handoffId/tags - Get tags for a handoff
  router.get(
    '/handoffs/:handoffId/tags',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const tags = await repository.getHandoffTags(req.params.handoffId)
      res.json(tags)
    })
  )

  // POST /handoffs/:handoffId/tags/:tagId - Assign a tag to a handoff (agents CAN do this)
  router.post(
    '/handoffs/:handoffId/tags/:tagId',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const assignedBy = req.tokenUser?.email
      await repository.assignTagToHandoff(
        req.params.handoffId,
        parseInt(req.params.tagId),
        assignedBy
      )
      res.status(201).json({ success: true })
    })
  )

  // DELETE /handoffs/:handoffId/tags/:tagId - Remove a tag from a handoff (agents CAN do this)
  router.delete(
    '/handoffs/:handoffId/tags/:tagId',
    errorMiddleware(async (req: RequestWithUser, res: Response) => {
      const removed = await repository.removeTagFromHandoff(
        req.params.handoffId,
        parseInt(req.params.tagId)
      )
      
      if (!removed) {
        return res.status(404).json({ message: 'Tag assignment not found' })
      }
      
      res.status(204).send()
    })
  )
}
