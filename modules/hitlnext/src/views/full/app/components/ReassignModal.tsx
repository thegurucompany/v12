import { Button, Dialog, HTMLSelect, Intent } from '@blueprintjs/core'
import { lang, toast } from 'botpress/shared'
import React, { FC, useState, useEffect } from 'react'

import { IAgent } from '../../../../types'
import { HitlClient } from '../../../client'

interface Props {
  api: HitlClient
  isOpen: boolean
  onClose: () => void
  handoffId: string
  currentAgentId: string
  currentAgent?: IAgent
}

const ReassignModal: FC<Props> = ({ api, isOpen, onClose, handoffId, currentAgentId, currentAgent }) => {
  const [agents, setAgents] = useState<IAgent[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const [reassigning, setReassigning] = useState<boolean>(false)

  useEffect(() => {
    if (isOpen) {
      void loadAvailableAgents()
    }
  }, [isOpen])

  const loadAvailableAgents = async () => {
    setLoading(true)
    try {
      const allAgents = await api.getAgents()
      const isSupervisor = currentAgent?.role === 'supervisor'

      // Supervisors can see all agents (including themselves)
      // Regular agents cannot see themselves
      const availableAgents = isSupervisor ? allAgents : allAgents.filter(agent => agent.agentId !== currentAgentId)

      setAgents(availableAgents)

      // Reset selection
      setSelectedAgentId('')
    } catch (error) {
      toast.failure(lang.tr('module.hitlnext.agent.reassignError'))
    } finally {
      setLoading(false)
    }
  }

  const handleReassign = async () => {
    if (!selectedAgentId) {
      return
    }

    setReassigning(true)
    try {
      await api.reassignConversation(handoffId, selectedAgentId)
      toast.success(lang.tr('module.hitlnext.agent.reassignSuccess'))
      onClose()
    } catch (error) {
      toast.failure(lang.tr('module.hitlnext.agent.reassignError'))
    } finally {
      setReassigning(false)
    }
  }

  const agentOptions = agents.map(agent => {
    const agentName = agent.attributes?.firstname
      ? `${agent.attributes.firstname} ${agent.attributes.lastname || ''}`.trim()
      : agent.attributes?.email || agent.agentId

    const status = agent.online ? '🟢' : '🔴'
    const statusText = agent.online ? 'online' : 'offline'

    // Show role badge for supervisors
    const roleText = agent.role === 'supervisor' ? ' [Supervisor]' : ''

    return {
      value: agent.agentId,
      label: `${status} ${agentName}${roleText} (${statusText})`
    }
  })

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={lang.tr('module.hitlnext.agent.reassignConversation')}
      icon="refresh"
      canEscapeKeyClose={!reassigning}
      canOutsideClickClose={!reassigning}
    >
      <div className="bp3-dialog-body">
        {loading ? (
          <p>{lang.tr('loading')}...</p>
        ) : agents.length === 0 ? (
          <p>{lang.tr('module.hitlnext.agent.noOtherAgents')}</p>
        ) : (
          <>
            <p>{lang.tr('module.hitlnext.agent.selectAgentToReassign')}</p>
            <HTMLSelect
              value={selectedAgentId}
              onChange={e => setSelectedAgentId(e.target.value)}
              options={[{ value: '', label: lang.tr('module.hitlnext.agent.selectAgent') }, ...agentOptions]}
              fill
              disabled={reassigning}
            />
          </>
        )}
      </div>
      <div className="bp3-dialog-footer">
        <div className="bp3-dialog-footer-actions">
          <Button text={lang.tr('cancel')} onClick={onClose} disabled={reassigning} />
          {agents.length > 0 && (
            <Button
              text={lang.tr('module.hitlnext.agent.reassignConversation')}
              intent={Intent.PRIMARY}
              onClick={handleReassign}
              loading={reassigning}
              disabled={!selectedAgentId || reassigning}
            />
          )}
        </div>
      </div>
    </Dialog>
  )
}

export default ReassignModal
