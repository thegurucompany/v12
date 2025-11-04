import { Callout } from '@blueprintjs/core'
import { ModuleUI, toast } from 'botpress/shared'
import _ from 'lodash'
import React from 'react'

import '../../../assets/default.css'
import { HitlSessionOverview, Message as HitlMessage } from '../../backend/typings'
import { Attribute } from '../../config'

import { makeApi } from './api'
import Composer from './components/Composer'
import Conversation from './components/messages/Conversation'
import Profile from './components/Profile'
import Sidebar from './components/Sidebar'

const { Container } = ModuleUI
interface State {
  loading: boolean
  filterPaused: boolean
  sessions: HitlSessionOverview[]
  currentSession: HitlSessionOverview
  filterSearchText: string
  attributesConfig: Attribute[]
  availableTags: string[]
  selectedTag: string
}

export default class HitlModule extends React.Component<{ bp: any }, State> {
  private api = makeApi(this.props.bp)
  private debounceQuerySessions = _.debounce(() => this.querySessions(), 700)
  private _isMounted: boolean = false

  state: State = {
    loading: false,
    sessions: null,
    currentSession: null,
    filterPaused: false,
    filterSearchText: undefined,
    attributesConfig: undefined,
    availableTags: [],
    selectedTag: undefined
  }

  async componentDidMount() {
    this._isMounted = true

    try {
      this.props.bp.events.on('hitl.message', this.updateSessionOverview)
      this.props.bp.events.on('hitl.new_session', this.refreshSessions)
      this.props.bp.events.on('hitl.session.changed', this.updateSession)

      // Lee el parámetro searchText de la URL
      const urlParams = new URLSearchParams(window.location.search)
      const searchText = urlParams.get('searchText')

      if (searchText) {
        this.setState({ filterSearchText: searchText })
      }

      await this.fetchAttributesConfig()
      await this.fetchAvailableTags()
      await this.refreshSessions()
    } catch (error) {
      console.error('Error initializing HITL module:', error)
    }
  }

  componentWillUnmount() {
    this._isMounted = false

    try {
      this.props.bp.events.off('hitl.message', this.updateSessionOverview)
      this.props.bp.events.off('hitl.new_session', this.refreshSessions)
      this.props.bp.events.off('hitl.session.changed', this.updateSession)
    } catch (error) {
      console.warn('Error removing event listeners in HITL module:', error.message)
    }
  }

  async fetchAttributesConfig() {
    if (!this._isMounted) {
      return
    }

    try {
      const attributesConfig = await this.api.getAttributes()
      if (this._isMounted) {
        this.setState({ attributesConfig })
      }
    } catch (error) {
      console.error('Error fetching attributes config:', error)
    }
  }

  async fetchAvailableTags() {
    if (!this._isMounted) {
      return
    }

    try {
      const availableTags = await this.api.getTags()
      if (this._isMounted) {
        this.setState({ availableTags })
      }
    } catch (error) {
      console.error('Error fetching available tags:', error)
    }
  }

  refreshSessions = async () => {
    if (!this._isMounted) {
      return
    }

    await this.querySessions()

    if (this._isMounted && !this.state.currentSession && this.state.sessions) {
      this.switchSession(_.head(this.state.sessions).id)
    }
  }

  updateSession = (changes: any) => {
    if (!this._isMounted || !this.state.sessions) {
      return
    }

    this.setState({
      sessions: this.state.sessions.map(session => {
        return Object.assign({}, session, session.id === changes.id ? changes : {})
      })
    })

    if (this._isMounted && this.state.currentSession) {
      this.switchSession(this.state.currentSession.id)
    }
  }

  updateSessionOverview = (message: HitlMessage) => {
    if (!this._isMounted || !this.state.sessions) {
      return
    }

    const session: HitlSessionOverview = this.state.sessions.find(x => x.id === message.session_id)
    if (!session) {
      return
    }

    const updatedSessionOverview = Object.assign({}, session, {
      lastMessage: {
        ...message,
        lastEventOn: new Date(),
        lastHeardOn: message.direction === 'in' ? new Date() : session.lastHeardOn
      } as HitlMessage
    })

    if (this._isMounted) {
      this.setState({ sessions: [updatedSessionOverview, ..._.without(this.state.sessions, session)] })
    }
  }

  querySessions = async () => {
    if (!this._isMounted) {
      return
    }

    try {
      const sessions = await this.api.findSessions(
        this.state.filterSearchText,
        this.state.filterPaused,
        this.state.selectedTag
      )
      if (this._isMounted) {
        this.setState({ loading: false, sessions })
      }
    } catch (err) {
      if (this._isMounted) {
        toast.failure(err.message)
      }
    }
  }

  toggleFilterPaused = () => {
    if (this._isMounted) {
      this.setState({ filterPaused: !this.state.filterPaused }, this.debounceQuerySessions)
    }
  }

  setFilterSearchText = (filterSearchText: string) => {
    if (this._isMounted) {
      this.setState({ filterSearchText }, this.debounceQuerySessions)
    }
  }

  setSelectedTag = (selectedTag: string) => {
    if (this._isMounted) {
      this.setState({ selectedTag }, this.debounceQuerySessions)
    }
  }

  switchSession = (sessionId: string) => {
    if (this._isMounted) {
      this.setState({ currentSession: this.state.sessions.find(x => x.id === sessionId) })
    }
  }

  render() {
    if (this.state.loading) {
      return <Callout>Loading...</Callout>
    }

    const currentSessionId = this.state.currentSession && this.state.currentSession.id

    return (
      <Container sidePanelWidth={450}>
        <Sidebar
          sessions={this.state.sessions}
          filterPaused={this.state.filterPaused}
          currentSessionId={currentSessionId}
          switchSession={this.switchSession}
          querySessions={this.querySessions}
          setFilterSearchText={this.setFilterSearchText}
          toggleFilterPaused={this.toggleFilterPaused}
          availableTags={this.state.availableTags}
          selectedTag={this.state.selectedTag}
          setSelectedTag={this.setSelectedTag}
        />

        <div className="bph-layout-main">
          <div className="bph-layout-middle">
            <Conversation
              api={this.api}
              events={this.props.bp.events}
              currentSession={this.state.currentSession}
              currentSessionId={currentSessionId}
            />
            <Composer api={this.api} currentSessionId={currentSessionId} />
          </div>
          <div className="bph-layout-profile">
            {this.state.currentSession && (
              <Profile
                user={this.state.currentSession.user}
                lastHeardOn={this.state.currentSession.lastHeardOn}
                attributesConfig={this.state.attributesConfig}
              />
            )}
          </div>
        </div>
      </Container>
    )
  }
}
