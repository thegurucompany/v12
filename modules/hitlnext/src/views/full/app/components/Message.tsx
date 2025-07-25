import { IO } from 'botpress/sdk'
import { Collapsible } from 'botpress/shared'
import cx from 'classnames'
import React, { FC } from 'react'

import style from '../../style.scss'

const renderPayload = (event: IO.Event) => {
  const { payload } = event

  // Handle image messages - check multiple possible structures
  if ((payload.type === 'image' || payload.payload?.type === 'image') && (payload.image || payload.payload?.image)) {
    const imageUrl = payload.image || payload.payload?.image
    const title = payload.title || payload.payload?.title || 'Image'

    return (
      <div className="image-message">
        <img
          src={imageUrl}
          alt={title}
          style={{ maxWidth: '300px', maxHeight: '200px', borderRadius: '8px', display: 'block' }}
          onError={e => {
            console.error('Failed to load image:', imageUrl)
            e.currentTarget.style.display = 'none'
          }}
        />
        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{title}</div>
      </div>
    )
  }

  // Handle video messages - check multiple possible structures
  if (
    (payload.type === 'video' || payload.payload?.type === 'video') &&
    (payload.video || payload.url || payload.payload?.video || payload.payload?.url)
  ) {
    const videoUrl = payload.video || payload.url || payload.payload?.video || payload.payload?.url
    const title = payload.title || payload.payload?.title || 'Video'

    return (
      <div className="video-message">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '8px',
            backgroundColor: '#f9f9f9'
          }}
        >
          <div style={{ fontSize: '24px', marginRight: '8px' }}>🎥</div>
          <div>
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: '#0066cc', fontWeight: 'bold' }}
            >
              Video: {title}
            </a>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {title
                .split('.')
                .pop()
                ?.toUpperCase() || 'VIDEO'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Handle voice/audio messages - check multiple possible structures
  if (
    (payload.type === 'voice' || payload.payload?.type === 'voice') &&
    (payload.audio || payload.url || payload.payload?.audio || payload.payload?.url)
  ) {
    const audioUrl = payload.audio || payload.url || payload.payload?.audio || payload.payload?.url
    const title = payload.title || payload.payload?.title || 'Audio de WhatsApp'
    const audioExtension = title
      .split('.')
      .pop()
      ?.toLowerCase()

    return (
      <div className="audio-message">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '8px',
            backgroundColor: '#f9f9f9'
          }}
        >
          <div style={{ fontSize: '24px', marginRight: '8px' }}>�</div>
          <div>
            <a
              href={audioUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: '#0066cc', fontWeight: 'bold' }}
            >
              {title}
            </a>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {audioExtension ? audioExtension.toUpperCase() : 'AUDIO'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Handle file messages - check multiple possible structures
  if ((payload.type === 'file' || payload.payload?.type === 'file') && (payload.url || payload.payload?.url)) {
    const fileUrl = payload.url || payload.payload?.url
    const fileName = payload.title || payload.payload?.title || 'File'
    const fileExtension = fileName
      .split('.')
      .pop()
      ?.toLowerCase()

    return (
      <div className="file-message">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px',
            border: '1px solid #ddd',
            borderRadius: '8px',
            backgroundColor: '#f9f9f9'
          }}
        >
          <div style={{ fontSize: '24px', marginRight: '8px' }}>📄</div>
          <div>
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: '#0066cc', fontWeight: 'bold' }}
            >
              {fileName}
            </a>
            <div style={{ fontSize: '12px', color: '#666' }}>
              {fileExtension ? fileExtension.toUpperCase() : 'FILE'}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Default rendering for other message types
  try {
    return (
      <Collapsible name={`type: ${payload.type}`}>
        <div>{JSON.stringify(payload, null, 2)}</div>
      </Collapsible>
    )
  } catch (error) {
    return null
  }
}

//TODO: To support complex content types, export message from webchat in ui-shared lite and show it here
export const Message: FC<IO.StoredEvent> = props => {
  const { preview } = props.event
  return (
    <div className={cx(style.messageContainer, props.direction === 'incoming' ? style.user : style.bot)}>
      <div className={cx(style.message)}>
        {preview && <span>{preview}</span>}
        {!preview && renderPayload(props.event)}
      </div>
    </div>
  )
}
