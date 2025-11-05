import { Collapsible, EmptyState, lang } from 'botpress/shared'
import _ from 'lodash'
import React, { FC, Fragment, useState } from 'react'

import { IHandoff } from '../../../../types'
import { HitlClient } from '../../../client'

import AssignmentHistoryItem from './AssignmentHistoryItem'

interface Props {
  api: HitlClient
  handoff: IHandoff
}

export const AssignmentHistory: FC<Props> = ({ handoff }) => {
  const { assignmentHistory } = handoff

  const [expanded, setExpanded] = useState(true)

  return (
    <Fragment>
      <Collapsible
        opened={expanded}
        toggleExpand={() => setExpanded(!expanded)}
        name={lang.tr('module.hitlnext.assignmentHistory.heading')}
        ownProps={{ transitionDuration: 10 }}
      >
        {_.isEmpty(assignmentHistory) && <EmptyState text={lang.tr('module.hitlnext.assignmentHistory.empty')} />}
        {!_.isEmpty(assignmentHistory) &&
          assignmentHistory.map(history => {
            return <AssignmentHistoryItem key={history.id} {...history}></AssignmentHistoryItem>
          })}
      </Collapsible>
    </Fragment>
  )
}
