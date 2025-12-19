import {
  Button,
  Card,
  Classes,
  Dialog,
  Icon,
  InputGroup,
  Intent,
  TextArea
} from '@blueprintjs/core'
import { lang, toast } from 'botpress/shared'
import cx from 'classnames'
import React, { FC, useEffect, useState } from 'react'

import { ITag, ITagCategory, makeClient, TagManagementClient } from './client'
import style from './style.scss'

interface Props {
  bp: { axios: any; events: any }
}

const App: FC<Props> = ({ bp }) => {
  const api = makeClient(bp)
  
  const [categories, setCategories] = useState<ITagCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set())
  
  // Dialog states
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  
  const [editingCategory, setEditingCategory] = useState<ITagCategory | null>(null)
  const [editingTag, setEditingTag] = useState<ITag | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'category' | 'tag'; id: number } | null>(null)
  
  // Form states
  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [categoryColor, setCategoryColor] = useState('#5c7080')
  const [tagName, setTagName] = useState('')
  const [tagDescription, setTagDescription] = useState('')

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    try {
      const data = await api.getCategories()
      setCategories(data)
      // Expand all categories by default
      setExpandedCategories(new Set(data.map(c => c.id)))
    } catch (error) {
      toast.failure(lang.tr('module.tag-management.messages.error'))
    } finally {
      setLoading(false)
    }
  }

  function toggleCategory(categoryId: number) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }

  // Category handlers
  function openNewCategoryDialog() {
    setEditingCategory(null)
    setCategoryName('')
    setCategoryDescription('')
    setCategoryColor('#5c7080')
    setCategoryDialogOpen(true)
  }

  function openEditCategoryDialog(category: ITagCategory) {
    setEditingCategory(category)
    setCategoryName(category.name)
    setCategoryDescription(category.description || '')
    setCategoryColor(category.color || '#5c7080')
    setCategoryDialogOpen(true)
  }

  async function saveCategory() {
    try {
      if (editingCategory) {
        await api.updateCategory(editingCategory.id, {
          name: categoryName,
          description: categoryDescription,
          color: categoryColor
        })
        toast.success(lang.tr('module.tag-management.messages.categoryUpdated'))
      } else {
        await api.createCategory({
          name: categoryName,
          description: categoryDescription,
          color: categoryColor
        })
        toast.success(lang.tr('module.tag-management.messages.categoryCreated'))
      }
      setCategoryDialogOpen(false)
      loadCategories()
    } catch (error) {
      toast.failure(lang.tr('module.tag-management.messages.error'))
    }
  }

  // Tag handlers
  function openNewTagDialog(categoryId: number) {
    setEditingTag(null)
    setSelectedCategoryId(categoryId)
    setTagName('')
    setTagDescription('')
    setTagDialogOpen(true)
  }

  function openEditTagDialog(tag: ITag) {
    setEditingTag(tag)
    setSelectedCategoryId(tag.categoryId)
    setTagName(tag.name)
    setTagDescription(tag.description || '')
    setTagDialogOpen(true)
  }

  async function saveTag() {
    try {
      if (editingTag) {
        await api.updateTag(editingTag.id, {
          name: tagName,
          description: tagDescription
        })
        toast.success(lang.tr('module.tag-management.messages.tagUpdated'))
      } else {
        await api.createTag({
          categoryId: selectedCategoryId!,
          name: tagName,
          description: tagDescription
        })
        toast.success(lang.tr('module.tag-management.messages.tagCreated'))
      }
      setTagDialogOpen(false)
      loadCategories()
    } catch (error) {
      toast.failure(lang.tr('module.tag-management.messages.error'))
    }
  }

  // Delete handlers
  function openDeleteDialog(type: 'category' | 'tag', id: number) {
    setDeleteTarget({ type, id })
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    
    try {
      if (deleteTarget.type === 'category') {
        await api.deleteCategory(deleteTarget.id)
        toast.success(lang.tr('module.tag-management.messages.categoryDeleted'))
      } else {
        await api.deleteTag(deleteTarget.id)
        toast.success(lang.tr('module.tag-management.messages.tagDeleted'))
      }
      setDeleteDialogOpen(false)
      setDeleteTarget(null)
      loadCategories()
    } catch (error) {
      toast.failure(lang.tr('module.tag-management.messages.error'))
    }
  }

  if (loading) {
    return <div className={style.tagManagement}>Loading...</div>
  }

  return (
    <div className={style.tagManagement}>
      <div className={style.header}>
        <h1 className={style.title}>{lang.tr('module.tag-management.categories.title')}</h1>
        <Button
          intent={Intent.PRIMARY}
          icon="plus"
          text={lang.tr('module.tag-management.categories.create')}
          onClick={openNewCategoryDialog}
        />
      </div>

      {categories.length === 0 && (
        <div className={style.emptyState}>
          <Icon icon="tag" size={48} className={style.emptyIcon} />
          <p>{lang.tr('module.tag-management.categories.empty')}</p>
        </div>
      )}

      {categories.map(category => (
        <div key={category.id} className={style.categoryCard}>
          <div className={style.categoryHeader} onClick={() => toggleCategory(category.id)}>
            <div className={style.categoryTitle}>
              <Icon 
                icon="chevron-right" 
                className={cx(style.chevron, expandedCategories.has(category.id) && style.chevronExpanded)}
              />
              <div 
                className={style.categoryColor} 
                style={{ backgroundColor: category.color || '#5c7080' }}
              />
              <span className={style.categoryName}>{category.name}</span>
              <span style={{ color: '#8a9ba8', marginLeft: 8 }}>
                ({category.tags?.length || 0})
              </span>
            </div>
            <div className={style.categoryActions} onClick={e => e.stopPropagation()}>
              <Button
                minimal
                small
                icon="edit"
                onClick={() => openEditCategoryDialog(category)}
              />
              <Button
                minimal
                small
                icon="trash"
                intent={Intent.DANGER}
                onClick={() => openDeleteDialog('category', category.id)}
              />
            </div>
          </div>
          
          {expandedCategories.has(category.id) && (
            <div className={style.tagList}>
              {(!category.tags || category.tags.length === 0) && (
                <p style={{ color: '#8a9ba8', margin: 0 }}>
                  {lang.tr('module.tag-management.tags.empty')}
                </p>
              )}
              
              {category.tags?.map(tag => (
                <div key={tag.id} className={style.tagItem}>
                  <div>
                    <div className={style.tagName}>{tag.name}</div>
                    {tag.description && (
                      <div className={style.tagDescription}>{tag.description}</div>
                    )}
                  </div>
                  <div>
                    <Button
                      minimal
                      small
                      icon="edit"
                      onClick={() => openEditTagDialog(tag)}
                    />
                    <Button
                      minimal
                      small
                      icon="trash"
                      intent={Intent.DANGER}
                      onClick={() => openDeleteDialog('tag', tag.id)}
                    />
                  </div>
                </div>
              ))}
              
              <Button
                minimal
                small
                icon="plus"
                text={lang.tr('module.tag-management.tags.create')}
                className={style.addTagButton}
                onClick={() => openNewTagDialog(category.id)}
              />
            </div>
          )}
        </div>
      ))}

      {/* Category Dialog */}
      <Dialog
        isOpen={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
        title={editingCategory 
          ? lang.tr('module.tag-management.categories.edit')
          : lang.tr('module.tag-management.categories.create')
        }
      >
        <div className={Classes.DIALOG_BODY}>
          <div className={style.formGroup}>
            <label className={style.formLabel}>
              {lang.tr('module.tag-management.categories.name')}
            </label>
            <InputGroup
              value={categoryName}
              onChange={(e: any) => setCategoryName(e.target.value)}
              placeholder="e.g., Logística"
            />
          </div>
          <div className={style.formGroup}>
            <label className={style.formLabel}>
              {lang.tr('module.tag-management.categories.description')}
            </label>
            <TextArea
              fill
              value={categoryDescription}
              onChange={(e: any) => setCategoryDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className={style.formGroup}>
            <label className={style.formLabel}>
              {lang.tr('module.tag-management.categories.color')}
            </label>
            <input
              type="color"
              value={categoryColor}
              onChange={(e: any) => setCategoryColor(e.target.value)}
            />
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={style.dialogActions} style={{marginBottom: 20 }}>
            <Button onClick={() => setCategoryDialogOpen(false)}>
              {lang.tr('module.tag-management.actions.cancel')}
            </Button>
            <Button 
              intent={Intent.PRIMARY} 
              onClick={saveCategory}
              disabled={!categoryName.trim()}
            >
              {lang.tr('module.tag-management.actions.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Tag Dialog */}
      <Dialog
        isOpen={tagDialogOpen}
        onClose={() => setTagDialogOpen(false)}
        title={editingTag 
          ? lang.tr('module.tag-management.tags.edit')
          : lang.tr('module.tag-management.tags.create')
        }
      >
        <div className={Classes.DIALOG_BODY}>
          <div className={style.formGroup}>
            <label className={style.formLabel}>
              {lang.tr('module.tag-management.tags.name')}
            </label>
            <InputGroup
              value={tagName}
              onChange={(e: any) => setTagName(e.target.value)}
              placeholder="e.g., Retraso"
            />
          </div>
          <div className={style.formGroup}>
            <label className={style.formLabel}>
              {lang.tr('module.tag-management.tags.description')}
            </label>
            <TextArea
              fill
              value={tagDescription}
              onChange={(e: any) => setTagDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={style.dialogActions}>
            <Button onClick={() => setTagDialogOpen(false)}>
              {lang.tr('module.tag-management.actions.cancel')}
            </Button>
            <Button 
              intent={Intent.PRIMARY} 
              onClick={saveTag}
              disabled={!tagName.trim()}
            >
              {lang.tr('module.tag-management.actions.save')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title={deleteTarget?.type === 'category' 
          ? lang.tr('module.tag-management.categories.delete')
          : lang.tr('module.tag-management.tags.delete')
        }
      >
        <div className={Classes.DIALOG_BODY}>
          <p>
            {deleteTarget?.type === 'category'
              ? lang.tr('module.tag-management.categories.deleteConfirm')
              : lang.tr('module.tag-management.tags.deleteConfirm')
            }
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={style.dialogActions} style={{marginBottom: 20 }}>
            <Button onClick={() => setDeleteDialogOpen(false)}>
              {lang.tr('module.tag-management.actions.cancel')}
            </Button>
            <Button intent={Intent.DANGER} onClick={confirmDelete}>
              {lang.tr('module.tag-management.actions.delete')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

export default ({ bp }) => {
  return <App bp={bp} />
}
