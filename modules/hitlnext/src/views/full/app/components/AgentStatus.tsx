import { Button, Icon, Dialog } from '@blueprintjs/core'
import { lang, MoreOptions, toast } from 'botpress/shared'
import React, { FC, useState } from 'react'

import { IAgent } from '../../../../types'
import AgentIcon from '../../shared/components/AgentIcon'
import style from '../../style.scss'

type Props = {
  setOnline: (online) => {}
  loading: boolean
  api?: any
} & Partial<IAgent>

const AgentStatus: FC<Props> = ({ setOnline, online, loading, api }) => {
  const [display, setDisplay] = useState(false)
  const [showReassignDialog, setShowReassignDialog] = useState(false)
  const [reassigning, setReassigning] = useState(false)

  const handleReassignAll = async () => {
    if (!api) {
      toast.failure(lang.tr('module.hitlnext.agent.reassignAllError'))
      return
    }

    setReassigning(true)
    try {
      const result = await api.reassignAllConversations()
      if (result.reassigned > 0) {
        toast.success(lang.tr('module.hitlnext.agent.reassignAllSuccess') + ` (${result.reassigned} conversaciones)`)
      } else {
        toast.info('No hay conversaciones asignadas para reasignar')
      }
    } catch (error) {
      toast.failure(lang.tr('module.hitlnext.agent.reassignAllError'))
    } finally {
      setReassigning(false)
      setShowReassignDialog(false)
    }
  }

  const optionsItems = [
    {
      label: lang.tr(`module.hitlnext.agent.${online ? 'getOffline' : 'getOnline'}`),
      action: () => {
        setOnline(!online)
      }
    },
    ...(online
      ? [
          {
            label: lang.tr('module.hitlnext.agent.reassignAll'),
            action: () => {
              setShowReassignDialog(true)
            }
          }
        ]
      : [])
  ]

  return (
    <>
      <div className={style.agentBtnWrapper}>
        <MoreOptions
          element={
            <Button className={style.agentBtn} onClick={() => setDisplay(true)} loading={loading} minimal={true}>
              <AgentIcon online={online} />
              <span className={style.agentBtnText}>
                {online ? lang.tr('module.hitlnext.agent.online') : lang.tr('module.hitlnext.agent.offline')}
              </span>
              <Icon icon="chevron-down"></Icon>
            </Button>
          }
          show={display}
          onToggle={() => setDisplay(false)}
          items={optionsItems}
        />
      </div>

      <Dialog
        isOpen={showReassignDialog}
        onClose={() => setShowReassignDialog(false)}
        title={lang.tr('module.hitlnext.agent.reassignAll')}
        icon="refresh"
        canEscapeKeyClose={!reassigning}
        canOutsideClickClose={!reassigning}
      >
        <div className="bp3-dialog-body">
          <p>{lang.tr('module.hitlnext.agent.reassignAllConfirm')}</p>
        </div>
        <div className="bp3-dialog-footer">
          <div className="bp3-dialog-footer-actions">
            <Button onClick={() => setShowReassignDialog(false)} disabled={reassigning}>
              Cancelar
            </Button>
            <Button intent="warning" onClick={handleReassignAll} loading={reassigning}>
              {reassigning ? 'Reasignando...' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

export default AgentStatus
