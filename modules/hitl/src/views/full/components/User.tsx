import { Icon, Intent, Text } from '@blueprintjs/core'
import classnames from 'classnames'
import _ from 'lodash'
import moment from 'moment'
import React, { FC } from 'react'

import { HitlSessionOverview } from '../../../backend/typings'

interface Props {
  session: HitlSessionOverview
  className?: string
  switchSession: () => void
}

const User: FC<Props> = props => {
  const { lastEventOn, user, lastMessage, isPaused, sentiment, tags, issueResolved } = props.session

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
      <img src={avatarUrl} className="bph-picture-small" />

      <div style={{ display: 'flex' }} className="bph-user-container-info">
        <div>
          <div className="bph-user-name">{displayName}</div>
          <span>
            <Text ellipsize={true} className="bph-user-summary">
              <span className="bph-user-source">{textPrefix}</span>
              {lastMessage.text}
            </Text>
          </span>

          {/* Mostrar tags si existen */}
          {tags && tags.length > 0 && (
            <div style={{ marginTop: '4px' }}>
              {tags.slice(0, 3).map((tag, index) => (
                <span
                  key={index}
                  style={{
                    fontSize: '10px',
                    backgroundColor: '#e1f5fe',
                    color: '#0277bd',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    marginRight: '4px',
                    display: 'inline-block'
                  }}
                >
                  {tag}
                </span>
              ))}
              {tags.length > 3 && <span style={{ fontSize: '10px', color: '#666' }}>+{tags.length - 3}</span>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div className="bph-user-date">{dateFormatted}</div>

          {/* Indicadores de estado */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
            {sentiment && (
              <Icon icon={getSentimentIcon()} intent={getSentimentColor()} title={`Sentiment: ${sentiment}`} />
            )}
            {issueResolved && <Icon icon="tick-circle" intent={Intent.SUCCESS} title="Issue Resolved" />}
            {!!isPaused && <Icon icon="pause" intent={Intent.PRIMARY} className="bph-user-paused-active" />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default User
