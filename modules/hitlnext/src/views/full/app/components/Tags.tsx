import { Menu, MenuDivider, MenuItem } from '@blueprintjs/core'
import { MultiSelect } from '@blueprintjs/select'
import { AxiosInstance } from 'axios'
import { Collapsible, EmptyState, isOperationAllowed, lang, PermissionOperation } from 'botpress/shared'
import _ from 'lodash'
import React, { FC, useContext, useEffect, useState } from 'react'

import { IHandoff } from '../../../../types'
import { HitlClient } from '../../../client'
import { Context } from '../Store'

interface ITagCategory {
  id: number
  name: string
  color?: string
  tags?: ITagItem[]
}

interface ITagItem {
  id: number
  categoryId: number
  name: string
  category?: ITagCategory
}

interface Props {
  api: HitlClient
  handoff: IHandoff
  bp: { axios: AxiosInstance }
}

// Tag item with display info for the multi-select
interface TagOption {
  id: number
  name: string
  categoryName: string
  categoryColor?: string
  displayName: string
}

const TagMultiSelect = MultiSelect.ofType<TagOption>()

export const Tags: FC<Props> = ({ handoff, api, bp }) => {
  const { id } = handoff
  const { state, dispatch } = useContext(Context)

  const [expanded, setExpanded] = useState(true)
  const [categories, setCategories] = useState<ITagCategory[]>([])
  const [selectedTags, setSelectedTags] = useState<TagOption[]>([])
  const [loading, setLoading] = useState(true)

  // Flatten categories into tag options
  const allTagOptions: TagOption[] = categories.flatMap(cat =>
    (cat.tags || []).map(tag => ({
      id: tag.id,
      name: tag.name,
      categoryName: cat.name,
      categoryColor: cat.color,
      displayName: `${cat.name} / ${tag.name}`
    }))
  )

  function currentAgentHasPermission(operation: PermissionOperation): boolean {
    // Supervisors and admins should always have access even if not "online" as agents
    const isSupervisorOrAdmin = state.currentAgent?.role === 'supervisor' || state.currentAgent?.role === 'admin'
    if (isSupervisorOrAdmin) {
      return true
    }
    // For agents, check online status and permissions
    return (
      state.currentAgent?.online &&
      isOperationAllowed({ user: state.currentAgent, resource: 'module.hitlnext', operation })
    )
  }

  // Load categories from tag-management module
  async function loadCategories() {
    try {
      const response = await bp.axios.get('/mod/tag-management/categories')
      setCategories(response.data || [])
    } catch (error) {
      console.error('Failed to load tag categories:', error)
      setCategories([])
    }
  }

  // Load assigned tags for this handoff
  async function loadHandoffTags() {
    try {
      const response = await bp.axios.get(`/mod/tag-management/handoffs/${id}/tags`)
      const assigned = response.data || []
      
      // Convert to TagOptions
      const options: TagOption[] = assigned.map((ht: any) => ({
        id: ht.tag?.id || ht.tagId,
        name: ht.tag?.name || '',
        categoryName: ht.tag?.category?.name || '',
        categoryColor: ht.tag?.category?.color,
        displayName: `${ht.tag?.category?.name || ''} / ${ht.tag?.name || ''}`
      }))
      
      setSelectedTags(options)
    } catch (error) {
      console.error('Failed to load handoff tags:', error)
      setSelectedTags([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
    loadHandoffTags()
  }, [id])

  async function handleSelect(tag: TagOption) {
    if (isSelected(tag)) {
      return
    }

    try {
      await bp.axios.post(`/mod/tag-management/handoffs/${id}/tags/${tag.id}`)
      setSelectedTags([...selectedTags, tag])
    } catch (error) {
      dispatch({ type: 'setError', payload: error })
    }
  }

  async function handleRemove(_value: string, index: number) {
    const tagToRemove = selectedTags[index]
    if (!tagToRemove) return

    try {
      await bp.axios.delete(`/mod/tag-management/handoffs/${id}/tags/${tagToRemove.id}`)
      setSelectedTags(selectedTags.filter((_, i) => i !== index))
    } catch (error) {
      dispatch({ type: 'setError', payload: error })
    }
  }

  function renderTag(tag: TagOption) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {tag.categoryColor && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: tag.categoryColor,
              flexShrink: 0
            }}
          />
        )}
        {tag.name}
      </span>
    )
  }

  function renderItem(tag: TagOption, { modifiers, handleClick }) {
    if (!modifiers.matchesPredicate) {
      return null
    }

    const selected = isSelected(tag)

    return (
      <MenuItem
        active={modifiers.active}
        disabled={selected}
        icon={selected ? 'tick' : 'blank'}
        onClick={handleClick}
        key={`${tag.categoryName}-${tag.id}`}
        text={
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {tag.categoryColor && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  backgroundColor: tag.categoryColor
                }}
              />
            )}
            {tag.name}
          </span>
        }
        labelElement={
          <span style={{ fontSize: 11, color: '#8a9ba8' }}>{tag.categoryName}</span>
        }
      />
    )
  }

  function filterTag(query: string, tag: TagOption) {
    const searchText = `${tag.categoryName} ${tag.name}`.toLowerCase()
    return searchText.indexOf(query.toLowerCase()) >= 0
  }

  function isSelected(tag: TagOption) {
    return selectedTags.some(t => t.id === tag.id)
  }

  // Group items by category for the item list renderer
  function itemListRenderer({ items, itemsParentRef, renderItem: render }) {
    if (items.length === 0) {
      return <MenuItem disabled={true} text={lang.tr('module.hitlnext.tags.noResults')} />
    }

    // Group by category
    const grouped = _.groupBy(items as TagOption[], 'categoryName')
    const categoryNames = Object.keys(grouped).sort()

    return (
      <Menu ulRef={itemsParentRef}>
        {categoryNames.map((catName, catIndex) => (
          <React.Fragment key={catName}>
            {catIndex > 0 && <MenuDivider />}
            <MenuDivider title={catName} />
            {grouped[catName].map((tag, idx) => render(tag, idx))}
          </React.Fragment>
        ))}
      </Menu>
    )
  }

  const hasNoTags = categories.length === 0 || allTagOptions.length === 0

  return (
    <Collapsible
      opened={expanded}
      toggleExpand={() => setExpanded(!expanded)}
      name={lang.tr('module.hitlnext.tags.heading')}
      ownProps={{ transitionDuration: 10 }}
    >
      {loading && <p style={{ color: '#8a9ba8' }}>Loading...</p>}
      {!loading && hasNoTags && <EmptyState text={lang.tr('module.hitlnext.tags.empty')} />}
      {!loading && !hasNoTags && (
        <TagMultiSelect
          fill={true}
          placeholder={lang.tr('module.hitlnext.tags.placeholder')}
          noResults={<MenuItem disabled={true} text={lang.tr('module.hitlnext.tags.noResults')} />}
          items={allTagOptions}
          selectedItems={selectedTags}
          itemRenderer={renderItem}
          itemPredicate={filterTag}
          itemListRenderer={itemListRenderer}
          onItemSelect={handleSelect}
          tagRenderer={renderTag}
          tagInputProps={{ onRemove: handleRemove, disabled: !currentAgentHasPermission('write') }}
        />
      )}
    </Collapsible>
  )
}
