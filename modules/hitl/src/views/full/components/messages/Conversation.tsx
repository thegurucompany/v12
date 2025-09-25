import _ from 'lodash'
import React from 'react'

import { HitlSessionOverview, Message as HitlMessage } from '../../../../backend/typings'
import { HitlApi } from '../../api'

import { ConversationHeader } from './ConversationHeader'
import { MessageList } from './MessageList'

interface Props {
  events: any
  currentSession: HitlSessionOverview
  api: HitlApi
  currentSessionId: string
}

export default class Conversation extends React.Component<Props> {
  private messagesDiv: HTMLElement
  private _isMounted: boolean = false

  state = {
    loading: true,
    messages: null
  }

  componentDidMount() {
    this._isMounted = true
    this.tryScrollToBottom(true)
    this.props.events.on('hitl.message', this.appendMessage)
  }

  componentWillUnmount() {
    this._isMounted = false
    try {
      this.props.events.off('hitl.message', this.appendMessage)
    } catch (error) {
      // Silently handle any errors during cleanup
      console.warn('Error removing event listener in HITL Conversation:', error.message)
    }
  }

  async componentDidUpdate(prevProps) {
    if (!this._isMounted) {
      return
    }

    this.tryScrollToBottom()
    if (prevProps.currentSessionId !== this.props.currentSessionId) {
      await this.fetchSessionMessages(this.props.currentSessionId)
    }
  }

  async fetchSessionMessages(sessionId) {
    if (!this._isMounted || !sessionId || sessionId === 'undefined') {
      return
    }

    this.setState({ loading: true })

    try {
      const messages = await this.props.api.fetchSessionMessages(sessionId)

      if (this._isMounted) {
        this.setState({ loading: false, messages })
        this.tryScrollToBottom()
      }
    } catch (error) {
      if (this._isMounted) {
        this.setState({ loading: false })
      }
      console.error('Error fetching session messages:', error)
    }
  }

  appendMessage = (message: HitlMessage) => {
    if (!this._isMounted || !this.state.messages || message.session_id !== this.props.currentSessionId) {
      return
    }

    this.setState({ messages: [...this.state.messages, message] })
    this.tryScrollToBottom()
  }

  tryScrollToBottom(delayed?: boolean) {
    setTimeout(
      () => {
        try {
          if (this._isMounted && this.messagesDiv && this.messagesDiv.parentNode) {
            this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight
          }
        } catch (err) {
          // Silently handle scroll errors to prevent DOM manipulation issues
          console.warn('Error scrolling messages in HITL:', err.message)
        }
      },
      delayed ? 200 : 0
    )
  }

  render() {
    if (!this.props.currentSession) {
      return null
    }

    const { user, id, isPaused } = this.props.currentSession
    const displayName = _.get(user, 'attributes.full_name', user.fullName)

    return (
      <div className="bph-conversation" style={{ overflow: 'hidden' }}>
        <ConversationHeader api={this.props.api} displayName={displayName} isPaused={!!isPaused} sessionId={id} />

        <div
          className="bph-conversation-messages"
          ref={m => {
            // Verificar que el componente aún está montado antes de asignar la referencia
            if (this._isMounted && m) {
              this.messagesDiv = m
            }
          }}
        >
          <MessageList messages={this.state.messages} />
        </div>
      </div>
    )
  }
}
