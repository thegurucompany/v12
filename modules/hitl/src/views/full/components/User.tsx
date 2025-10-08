import { Icon, Intent, Text } from '@blueprintjs/core'
import classnames from 'classnames'
import _ from 'lodash'
import moment from 'moment'
import React, { FC } from 'react'

import { HitlSessionOverview } from '../../../backend/typings'
import { Avatar } from './Avatar'

interface Props {
  session: HitlSessionOverview
  className?: string
  switchSession: () => void
}

const User: FC<Props> = props => {
  const {
    lastEventOn,
    user,
    lastMessage,
    isPaused,
    sentiment,
    tags,
    issueResolved,
    userType,
    messageChannel
  } = props.session

  const dateFormatted = moment(lastEventOn)
    .fromNow()
    .replace('minutes', 'mins')
    .replace('seconds', 'secs')

  const textPrefix = lastMessage.direction === 'in' ? 'User: ' : 'Bot: '
  const displayName = _.get(user, 'attributes.full_name', user.fullName)
  const avatarUrl = _.get(user, 'attributes.picture_url', user.avatarUrl)

  const getSentimentIcon = () => {
    switch (sentiment) {
      case 'positivo':
        return 'thumbs-up'
      case 'negativo':
        return 'thumbs-down'
      case 'neutro':
        return 'minus'
      default:
        return 'minus'
    }
  }

  const getSentimentColor = () => {
    switch (sentiment) {
      case 'positivo':
        return Intent.SUCCESS
      case 'negativo':
        return Intent.DANGER
      case 'neutro':
        return Intent.NONE
      default:
        return Intent.NONE
    }
  }

  return (
    <div className={classnames('bph-user-container', props.className)} onClick={props.switchSession}>
      <Avatar url={avatarUrl} className="bph-picture-small" />

      <div className="bph-user-container-info">
        <div>
          <div className="bph-user-name">{displayName}</div>
          {messageChannel && (
            <div className="bph-message-channel">
              <Text className="bph-channel-label">Canal: {messageChannel}</Text>
            </div>
          )}
          <span>
            <Text ellipsize={true} className="bph-user-summary">
              <span className="bph-user-source">{textPrefix}</span>
              {lastMessage.text}
            </Text>
          </span>

          {/* Mostrar tags y user_type en un solo contenedor */}
          {(tags && tags.length > 0) || userType ? (
            <div className="bph-user-tags">
              {/* Mostrar user_type primero si existe */}
              {userType && <span className="bph-user-type-tag">{userType}</span>}
              {/* Mostrar tags si existen */}
              {tags && tags.length > 0 && (
                <>
                  {tags.slice(0, 2).map((tag, index) => (
                    <span key={index} className="bph-user-tag">
                      {tag}
                    </span>
                  ))}
                  {tags.length > 2 && <span className="bph-user-tag-more">+{tags.length - 2}</span>}
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="bph-user-date">{dateFormatted}</div>

        {/* Indicadores de estado */}
        <div className="bph-user-status-indicators">
          {sentiment && (
            <div className="bph-status-icon" title={`Sentiment: ${sentiment}`}>
              <Icon icon={getSentimentIcon()} intent={getSentimentColor()} />
            </div>
          )}
          {issueResolved && (
            <div className="bph-status-icon" title="Issue Resolved">
              <Icon icon="tick-circle" intent={Intent.SUCCESS} />
            </div>
          )}
          {!!isPaused && (
            <div className="bph-status-icon" title="Paused">
              <Icon icon="pause" intent={Intent.PRIMARY} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default User
