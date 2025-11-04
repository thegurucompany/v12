import { Button, Classes, ControlGroup, HTMLSelect, Intent, Tooltip } from '@blueprintjs/core'
import { ModuleUI } from 'botpress/shared'
import React, { FC } from 'react'

import { HitlSessionOverview } from '../../../backend/typings'
import { UserList } from './UserList'

const { SearchBar } = ModuleUI

interface Props {
  toggleFilterPaused?: () => void
  setFilterSearchText: (terms: string) => void
  querySessions: () => void
  switchSession: (newSessionId: string) => void
  filterPaused: boolean
  currentSessionId: string
  sessions: HitlSessionOverview[]
  availableTags: string[]
  selectedTag: string
  setSelectedTag: (tag: string) => void
}

const Sidebar: FC<Props> = props => {
  const handleTagChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value
    props.setSelectedTag(value === '' ? undefined : value)
  }

  return (
    <div className="bph-sidebar">
      <div className="bph-sidebar-header">
        <ControlGroup fill={true}>
          <Tooltip
            content={props.filterPaused ? 'Show all conversations' : 'Show only paused conversations'}
            className={Classes.FIXED}
          >
            <Button
              icon="bookmark"
              intent={props.filterPaused ? Intent.PRIMARY : Intent.NONE}
              onClick={props.toggleFilterPaused}
              minimal={true}
              style={{ marginRight: 10 }}
            />
          </Tooltip>

          {props.availableTags && props.availableTags.length > 0 && (
            <Tooltip content="Filter by tag" className={Classes.FIXED}>
              <HTMLSelect
                value={props.selectedTag || ''}
                onChange={handleTagChange}
                style={{ marginRight: 10 }}
                minimal={true}
                iconProps={{ icon: 'tag', style: { marginRight: 5 } }}
              >
                <option value="">All tags</option>
                {props.availableTags.map(tag => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </HTMLSelect>
            </Tooltip>
          )}

          <SearchBar
            onChange={props.setFilterSearchText}
            placeholder="Search by name"
            onButtonClick={props.querySessions}
          />
        </ControlGroup>
      </div>

      <div className="bph-sidebar-users">
        <UserList
          sessions={props.sessions}
          currentSessionId={props.currentSessionId}
          switchSession={props.switchSession}
        />
      </div>
    </div>
  )
}

export default Sidebar
