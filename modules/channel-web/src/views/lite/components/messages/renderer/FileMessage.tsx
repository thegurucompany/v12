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
  // Handle mime and size information
  const mime = (props.file as any).mime || ''
  const size = (props.file as any).size || 0

  // Handle image property for images that might come through different structures
  // Priority: image property first, then url property
  const fileUrl = image || url
  const fileTitle = title || 'Archivo'

  // Ensure fileUrl is a string
  let fileUrlString = ''

  if (typeof fileUrl === 'string') {
    fileUrlString = fileUrl
  } else if (fileUrl && typeof fileUrl === 'object') {
    // Handle object cases - try to extract URL from common properties
    if (fileUrl.url) {
      fileUrlString = String(fileUrl.url)
    } else if (fileUrl.location) {
      fileUrlString = String(fileUrl.location)
    } else if (fileUrl.path) {
      fileUrlString = String(fileUrl.path)
    } else {
      // Last resort - try to get a meaningful string representation
      fileUrlString = JSON.stringify(fileUrl)
      console.warn('FileMessage: URL es un objeto sin propiedades reconocidas:', fileUrl)
    }
  } else if (fileUrl) {
    fileUrlString = String(fileUrl)
  }

  if (!fileUrlString || fileUrlString === '[object Object]' || fileUrlString === 'undefined') {
    return (
      <div className={'bpw-file-message'}>
        <div>No se pudo cargar el archivo</div>
      </div>
    )
  }

  let extension = ''
  let detectedMime = ''

  try {
    const validUrl = new URL(fileUrlString)
    extension = validUrl.pathname
  } catch (error) {
    // Try using path.extname since url might be relative.
    extension = path.extname(fileUrlString)
  }

  try {
    detectedMime = mimeTypes.getType(extension) || mime || ''
  } catch (error) {
    console.warn('Could not determine mime type for:', fileUrlString)
    detectedMime = mime || ''
  }

  // Helper function to format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) {
      return ''
    }
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
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
  const isImage = detectedMime.includes('image/') || fileUrlString.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)

  // Check if this is a PDF
  const isPdf = detectedMime === 'application/pdf' || fileUrlString.match(/\.pdf$/i)

  if (isImage) {
    return (
      <div className="bpw-image-container" style={{ marginBottom: '8px' }}>
        <div className="bpw-image-preview">
          <img
            src={fileUrlString}
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
              console.error('Failed to load image:', fileUrlString)
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
            onClick={() => window.open(fileUrlString, '_blank')}
          />
        </div>
        <div className="bpw-image-info" style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          <a
            href={fileUrlString}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: '8px', color: '#1976d2', textDecoration: 'none' }}
          >
            Ver en tamaño completo
          </a>
        </div>
      </div>
    )
  } else if (isPdf) {
    return (
      <div
        className="bpw-file-message"
        style={{
          padding: '12px',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          backgroundColor: '#f9f9f9',
          maxWidth: '300px',
          marginBottom: '8px'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px'
          }}
        >
          <div
            style={{
              fontSize: '32px',
              color: '#d32f2f',
              flexShrink: 0
            }}
          >
            📄
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 500,
                fontSize: '14px',
                color: '#333',
                marginBottom: '4px',
                wordBreak: 'break-word',
                lineHeight: '1.3'
              }}
            >
              {fileTitle}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#666',
                marginBottom: '8px'
              }}
            >
              <div>📋 Documento PDF</div>
              {size > 0 && <div style={{ marginTop: '2px' }}>📏 {formatFileSize(size)}</div>}
            </div>
          </div>
        </div>
        <div
          style={{
            marginTop: '8px',
            textAlign: 'center'
          }}
        >
          <a
            href={fileUrlString}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              backgroundColor: '#1976d2',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'background-color 0.2s'
            }}
            onMouseOver={e => {
              e.currentTarget.style.backgroundColor = '#1565c0'
            }}
            onMouseOut={e => {
              e.currentTarget.style.backgroundColor = '#1976d2'
            }}
          >
            📖 Abrir PDF
          </a>
        </div>
      </div>
    )
  } else if (detectedMime.includes('audio/')) {
    return (
      <div className={'bpw-file-message'}>
        <span>🎵 Audio: </span>
        <a href={fileUrlString} target={'_blank'} rel="noopener noreferrer">
          {fileTitle}
        </a>
      </div>
    )
  } else if (detectedMime.includes('video/')) {
    return (
      <video controls style={{ maxWidth: '194px' }}>
        <source src={fileUrlString} type={detectedMime} />
        Tu navegador no soporta el elemento de video.
      </video>
    )
  } else {
    return (
      <div className={'bpw-file-message'}>
        <span>📎 Archivo: </span>
        <a href={fileUrlString} target={'_blank'} rel="noopener noreferrer">
          {fileTitle}
        </a>
      </div>
    )
  }
}
