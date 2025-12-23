import * as sdk from 'botpress/sdk'
import _ from 'lodash'

import {
  CreateCategoryPayload,
  CreateTagPayload,
  IHandoffTag,
  ITag,
  ITagCategory,
  UpdateCategoryPayload,
  UpdateTagPayload
} from './types'

export default class Repository {
  constructor(private bp: typeof sdk) {}

  // ============ Categories ============

  async listCategories(botId: string): Promise<ITagCategory[]> {
    const categories = await this.bp.database('hitl_tag_categories')
      .where('bot_id', botId)
      .orWhereNull('bot_id')
      .orderBy('name')
      .select('*')

    const categoryIds = categories.map(c => c.id)
    
    if (categoryIds.length === 0) {
      return []
    }

    const tags = await this.bp.database('hitl_tags')
      .whereIn('categoryId', categoryIds)
      .orderBy('name')
      .select('*')

    const tagsByCategory = _.groupBy(tags, 'categoryId')

    return categories.map(cat => ({
      id: cat.id,
      botId: cat.bot_id,
      name: cat.name,
      description: cat.description,
      color: cat.color,
      createdAt: cat.createdAt,
      updatedAt: cat.updatedAt,
      tags: (tagsByCategory[cat.id] || []).map(tag => ({
        id: tag.id,
        categoryId: tag.categoryId,
        name: tag.name,
        description: tag.description,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt
      }))
    }))
  }

  async getCategoryById(id: number): Promise<ITagCategory | null> {
    const category = await this.bp.database('hitl_tag_categories')
      .where('id', id)
      .first()

    if (!category) {
      return null
    }

    const tags = await this.bp.database('hitl_tags')
      .where('categoryId', id)
      .orderBy('name')
      .select('*')

    return {
      id: category.id,
      botId: category.bot_id,
      name: category.name,
      description: category.description,
      color: category.color,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      tags: tags.map(tag => ({
        id: tag.id,
        categoryId: tag.categoryId,
        name: tag.name,
        description: tag.description,
        createdAt: tag.createdAt,
        updatedAt: tag.updatedAt
      }))
    }
  }

  async createCategory(botId: string, payload: CreateCategoryPayload): Promise<ITagCategory> {
    const [id] = await this.bp.database('hitl_tag_categories')
      .insert({
        bot_id: botId,
        name: payload.name,
        description: payload.description || null,
        color: payload.color || null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning('id')

    const insertedId = typeof id === 'object' ? id.id : id
    return this.getCategoryById(insertedId) as Promise<ITagCategory>
  }

  async updateCategory(id: number, payload: UpdateCategoryPayload): Promise<ITagCategory | null> {
    const updateData: any = { updatedAt: new Date() }
    
    if (payload.name !== undefined) updateData.name = payload.name
    if (payload.description !== undefined) updateData.description = payload.description
    if (payload.color !== undefined) updateData.color = payload.color

    await this.bp.database('hitl_tag_categories')
      .where('id', id)
      .update(updateData)

    return this.getCategoryById(id)
  }

  async deleteCategory(id: number): Promise<boolean> {
    const deleted = await this.bp.database('hitl_tag_categories')
      .where('id', id)
      .delete()

    return deleted > 0
  }

  // ============ Tags ============

  async getTagById(id: number): Promise<ITag | null> {
    const tag = await this.bp.database('hitl_tags')
      .where('id', id)
      .first()

    if (!tag) {
      return null
    }

    return {
      id: tag.id,
      categoryId: tag.categoryId,
      name: tag.name,
      description: tag.description,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt
    }
  }

  async createTag(payload: CreateTagPayload): Promise<ITag> {
    const [id] = await this.bp.database('hitl_tags')
      .insert({
        categoryId: payload.categoryId,
        name: payload.name,
        description: payload.description || null,
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .returning('id')

    const insertedId = typeof id === 'object' ? id.id : id
    return this.getTagById(insertedId) as Promise<ITag>
  }

  async updateTag(id: number, payload: UpdateTagPayload): Promise<ITag | null> {
    const updateData: any = { updatedAt: new Date() }
    
    if (payload.name !== undefined) updateData.name = payload.name
    if (payload.description !== undefined) updateData.description = payload.description

    await this.bp.database('hitl_tags')
      .where('id', id)
      .update(updateData)

    return this.getTagById(id)
  }

  async deleteTag(id: number): Promise<boolean> {
    const deleted = await this.bp.database('hitl_tags')
      .where('id', id)
      .delete()

    return deleted > 0
  }

  // ============ Handoff Tags ============

  async getHandoffTags(handoffId: string): Promise<IHandoffTag[]> {
    const rows = await this.bp.database('handoff_tags as ht')
      .join('hitl_tags as t', 'ht.tagId', 't.id')
      .join('hitl_tag_categories as c', 't.categoryId', 'c.id')
      .where('ht.handoffId', handoffId)
      .select(
        'ht.id',
        'ht.handoffId',
        'ht.tagId',
        'ht.createdAt',
        't.id as tag_id',
        't.categoryId as tag_categoryId',
        't.name as tag_name',
        't.description as tag_description',
        'c.id as category_id',
        'c.name as category_name',
        'c.color as category_color'
      )

    return rows.map(row => ({
      id: row.id,
      handoffId: row.handoffId,
      tagId: row.tagId,
      createdAt: row.createdAt,
      tag: {
        id: row.tag_id,
        categoryId: row.tag_categoryId,
        name: row.tag_name,
        description: row.tag_description,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        category: {
          id: row.category_id,
          botId: '',
          name: row.category_name,
          color: row.category_color,
          createdAt: row.createdAt,
          updatedAt: row.createdAt
        }
      }
    }))
  }

  async assignTagToHandoff(handoffId: string, tagId: number, assignedBy?: string): Promise<void> {
    // Use upsert logic to avoid duplicate key errors
    const existing = await this.bp.database('handoff_tags')
      .where({ handoffId, tagId })
      .first()

    if (!existing) {
      await this.bp.database('handoff_tags')
        .insert({
          handoffId,
          tagId,
          createdAt: new Date()
        })
    }
  }

  async removeTagFromHandoff(handoffId: string, tagId: number): Promise<boolean> {
    const deleted = await this.bp.database('handoff_tags')
      .where({ handoffId, tagId })
      .delete()

    return deleted > 0
  }
}
