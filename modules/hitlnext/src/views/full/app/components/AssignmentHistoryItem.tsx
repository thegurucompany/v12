import { ContentSection, lang } from 'botpress/shared'
import moment from 'moment'
import React, { FC, useContext } from 'react'

import { agentName } from '../../../../helper'
import { IAssignmentHistory } from '../../../../types'
import style from '../../style.scss'
import { Context } from '../Store'

const AssignmentHistoryItem: FC<IAssignmentHistory> = props => {
  const { state } = useContext(Context)
  moment.locale(lang.getLocale())

  function formatDate(str) {
    return moment(str).format('DD/MM/YYYY HH:mm')
  }

  function getFromAgent() {
    if (!props.fromAgentId) {
      return null
    }
    const agent = state.agents[props.fromAgentId]
    return agent ? agentName(agent) : props.fromAgentId
  }

  function getToAgent() {
    const agent = state.agents[props.toAgentId]
    return agent ? agentName(agent) : props.toAgentId
  }

  function getDisplayText() {
    const toAgent = getToAgent()

    if (props.actionType === 'assigned') {
      // Initial assignment
      return lang.tr('module.hitlnext.assignmentHistory.assigned', { agentName: toAgent })
    } else {
      // Reassignment
      const fromAgent = getFromAgent()
      if (!fromAgent) {
        // Automatic reassignment (system triggered)
        return lang.tr('module.hitlnext.assignmentHistory.automatic', { toAgent })
      } else {
        // Manual reassignment
        return lang.tr('module.hitlnext.assignmentHistory.reassigned', { fromAgent, toAgent })
      }
    }
  }

  return (
    <ContentSection title={formatDate(props.createdAt)}>
      <ul>
        <li>{getDisplayText()}</li>
      </ul>
    </ContentSection>
  )
}

export default AssignmentHistoryItem
