import { Spinner } from '@blueprintjs/core'
import { AxiosInstance } from 'axios'
import { IO } from 'botpress/sdk'
import { lang } from 'botpress/shared'
import _ from 'lodash'
import moment from 'moment'
import React, { FC, Fragment, useContext, useEffect, useCallback, useState } from 'react'

import { WEBSOCKET_TOPIC } from '../../../../constants'
import { IHandoff, ISocketMessage } from '../../../../types'
import { HitlClient } from '../../../client'
import { Context } from '../Store'
import MessageList from './MessageList'

interface Props {
  api: HitlClient
  bp: { axios: AxiosInstance; events: any }
  conversationId: string
}

const ConversationHistory: FC<Props> = ({ api, bp, conversationId }) => {
  const { state } = useContext(Context)

  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<IO.StoredEvent[]>([])

  const handleMessage = useCallback(
    (message: ISocketMessage) => {
      if (message.resource === 'event' && message.type === 'create') {
        if (message.payload.threadId === conversationId) {
          setEvents(evts => [...evts, message.payload])
        }
      }
    },
    [conversationId]
  )

  useEffect(() => {
    bp.events.on(`${WEBSOCKET_TOPIC}:${window.BOT_ID}`, handleMessage)
    return () => bp.events.off(`${WEBSOCKET_TOPIC}:${window.BOT_ID}`, handleMessage)
  }, [conversationId])

  useEffect(() => {
    void api.getMessages(conversationId, 'id', true, 5).then(evts => {
      setEvents(evts)
      setLoading(false)
    })
  }, [conversationId])

  const lastEvent = _.maxBy(events, 'id')
  moment.locale(lang.getLocale())
  const timeElapsed = lastEvent ? moment(lastEvent.createdOn).fromNow() : ''

  return (
    <Fragment>
      {loading && <Spinner></Spinner>}
      {!loading && (
        <Fragment>
          <MessageList events={events}></MessageList>
          {lastEvent && (
            <div
              style={{
                fontSize: '18px',
                fontWeight: 'bold',
                textAlign: 'center',
                margin: '10px 0',
                padding: '15px',
                color: '#444',
                backgroundColor: '#f5f5f5',
                borderRadius: '5px',
                border: '1px solid #e0e0e0'
              }}
            >
              Tiempo transcurrido desde la última respuesta: {timeElapsed}
            </div>
          )}
        </Fragment>
      )}
    </Fragment>
  )
}

export default ConversationHistory
