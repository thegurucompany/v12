import { lang } from 'botpress/shared'
import cx from 'classnames'
import moment from 'moment'
import ms from 'ms'
import React, { FC, useEffect, useState } from 'react'

import { IHandoff } from '../../../../types'
import styles from '../../style.scss'

const HandoffItem: FC<IHandoff> = props => {
  moment.locale(lang.getLocale())
  const [fromNow, setFromNow] = useState(moment(props.createdAt).fromNow())
  useEffect(() => {
    const refreshRate = ms('1m')

    const interval = setInterval(() => {
      setFromNow(moment(props.createdAt).fromNow())
    }, refreshRate)
    return () => clearInterval(interval)
  }, [])

  // Extract the last message text from the user conversation
  const getLastMessageText = () => {
    if (!props.userConversation || !props.userConversation.event) {
      return lang.tr('module.hitlnext.handoff.noMessage')
    }

    const event = props.userConversation.event
    let text = ''

    // Handle different event types
    switch (event.type) {
      case 'text':
        text = event.preview || (event.payload && event.payload.text) || ''
        break
      case 'image':
        text = '📷 ' + (lang.tr('module.hitlnext.handoff.imageMessage') || 'Image')
        break
      case 'file':
        text = '📎 ' + (lang.tr('module.hitlnext.handoff.fileMessage') || 'File')
        break
      case 'audio':
        text = '🎵 ' + (lang.tr('module.hitlnext.handoff.audioMessage') || 'Audio')
        break
      case 'video':
        text = '🎥 ' + (lang.tr('module.hitlnext.handoff.videoMessage') || 'Video')
        break
      case 'location':
        text = '📍 ' + (lang.tr('module.hitlnext.handoff.locationMessage') || 'Location')
        break
      case 'quick_reply':
        text = event.preview || (event.payload && event.payload.text) || lang.tr('module.hitlnext.handoff.quickReply')
        break
      case 'carousel':
        text = '🎠 ' + (lang.tr('module.hitlnext.handoff.carouselMessage') || 'Carousel')
        break
      default:
        text = event.preview || lang.tr('module.hitlnext.handoff.unknownMessage')
    }

    if (!text) {
      return lang.tr('module.hitlnext.handoff.noMessage')
    }

    // Truncate long messages to show a preview
    return text.length > 80 ? `${text.substring(0, 80)}...` : text
  }

  return (
    <div className={cx(styles.handoffItem)}>
      <div className={styles.info}>
        <p>#{props.id}</p>
        <p className="bp3-text-small bp3-text-muted">
          {props.status} ⋅ {lang.tr('module.hitlnext.handoff.created', { date: fromNow })}
        </p>
        <p
          className="bp3-text-small"
          style={{ marginTop: '4px', color: '#666', fontStyle: 'italic', fontSize: '11px', lineHeight: '1.3' }}
        >
          {getLastMessageText()}
        </p>
      </div>
    </div>
  )
}

export default HandoffItem
