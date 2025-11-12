import { Button, FormGroup, InputGroup, Intent, TextArea } from '@blueprintjs/core'
import React, { FC, useState, useEffect } from 'react'

import { IMacro } from '../MacrosApp'
import styles from './MacroForm.scss'

interface Props {
  macro: IMacro | null
  onSave: (macro: IMacro) => void
  onCancel: () => void
}

const MacroForm: FC<Props> = ({ macro, onSave, onCancel }) => {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (macro) {
      setName(macro.name)
      setContent(macro.content)
    } else {
      setName('')
      setContent('')
    }
  }, [macro])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !content.trim()) {
      return
    }

    const macroData: Partial<IMacro> = {
      name: name.trim(),
      content: content.trim()
    }

    // Si estamos editando, incluir el ID
    if (macro?.id) {
      macroData.id = macro.id
    }

    onSave(macroData as IMacro)
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <FormGroup
        label="Nombre de la Macro"
        labelFor="macro-name"
        helperText="Un nombre corto y descriptivo para la macro"
      >
        <InputGroup
          id="macro-name"
          placeholder="Ej: Saludo Inicial"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
      </FormGroup>

      <FormGroup label="Contenido" labelFor="macro-content" helperText="El texto completo de la respuesta">
        <TextArea
          id="macro-content"
          placeholder="Escribe el contenido de la macro aquí..."
          value={content}
          onChange={e => setContent(e.target.value)}
          fill
          growVertically
          rows={10}
        />
      </FormGroup>

      <div className={styles.actions}>
        <Button text="Cancelar" onClick={onCancel} />
        <Button
          type="submit"
          intent={Intent.PRIMARY}
          text={macro ? 'Actualizar' : 'Crear'}
          disabled={!name.trim() || !content.trim()}
        />
      </div>
    </form>
  )
}

export default MacroForm
