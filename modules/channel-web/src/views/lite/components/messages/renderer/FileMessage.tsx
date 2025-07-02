import mimeTypes from 'mime/lite'
import path from 'path'
import React from 'react'

import { Renderer } from '../../../typings'

import { Text } from './Text'
import './file-message-styles.css'

export const FileMessage = (props: Renderer.FileMessage) => {
  if (!props.file) {
    return null
  }

  const { url, title, storage, text } = props.file
  // Handle image property that might exist in some file objects
  const image = (props.file as any).image

  // Handle image property for images that might come through different structures
  // Priority: image property first, then url property
  const fileUrl = image || url
  const fileTitle = title || 'Archivo'

  // Debug logging for development (remove in production)
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line no-console
    console.log('FileMessage rendering:', {
      hasUrl: !!url,
      hasImage: !!image,
      finalUrl: fileUrl,
      title: fileTitle,
      storage,
      originalFile: props.file
    })
  }

  if (!fileUrl) {
    console.warn('FileMessage: No URL or image provided', props.file)
    return (
      <div className={'bpw-file-message'}>
        <div>No se pudo cargar el archivo</div>
      </div>
    )
  }

  let extension = ''
  let mime = ''

  try {
    const validUrl = new URL(fileUrl)
    extension = validUrl.pathname
  } catch (error) {
    // Try using path.extname since url might be relative.
    extension = path.extname(fileUrl)
  }

  try {
    mime = mimeTypes.getType(extension) || ''
  } catch (error) {
    console.warn('Could not determine mime type for:', fileUrl)
    mime = ''
  }

  if (text) {
    return <Text text={text} markdown escapeHTML={props.escapeTextHTML} />
  }

  if (storage === 'local') {
    return (
      <div className={'bpw-file-message'}>
        <div>{fileTitle} (local)</div>
      </div>
    )
  }

  // Check if this is an image - either by MIME type or file extension
  const isImage = mime.includes('image/') || fileUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)

  if (isImage) {
    return (
      <div className="bpw-image-container" style={{ marginBottom: '8px' }}>
        <div className="bpw-image-preview">
          <img
            src={fileUrl}
            title={fileTitle}
            alt={fileTitle}
            style={{
              maxWidth: '250px',
              maxHeight: '300px',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              border: '1px solid #e0e0e0',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'block'
            }}
            onError={e => {
              console.error('Failed to load image:', fileUrl)
              const target = e.currentTarget
              target.style.display = 'none'
              const errorDiv = document.createElement('div')
              errorDiv.innerHTML = `
                <div style="padding: 10px; border: 1px solid #ffcdd2; background: #ffebee; border-radius: 4px; color: #c62828;">
                  <span>❌ No se pudo cargar la imagen</span><br/>
                  <small style="color: #666;">${fileTitle}</small>
                </div>
              `
              target.parentElement?.appendChild(errorDiv)
            }}
            onClick={() => window.open(fileUrl, '_blank')}
          />
        </div>
        <div className="bpw-image-info" style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: '8px', color: '#1976d2', textDecoration: 'none' }}
          >
            Ver en tamaño completo
          </a>
        </div>
      </div>
    )
  } else if (mime.includes('audio/')) {
    return (
      <audio controls>
        <source src={fileUrl} type={mime} />
        Tu navegador no soporta el elemento de audio.
      </audio>
    )
  } else if (mime.includes('video/')) {
    return (
      <video controls style={{ maxWidth: '194px' }}>
        <source src={fileUrl} type={mime} />
        Tu navegador no soporta el elemento de video.
      </video>
    )
  } else {
    return (
      <div className={'bpw-file-message'}>
        <span>📎 Archivo: </span>
        <a href={fileUrl} target={'_blank'} rel="noopener noreferrer">
          {fileTitle}
        </a>
      </div>
    )
  }
}
