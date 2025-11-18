import { Button, Card, Elevation, Icon, Intent } from '@blueprintjs/core'
import React, { FC } from 'react'

import { IMacro } from '../MacrosApp'
import styles from './MacrosList.scss'

interface Props {
  macros: IMacro[]
  onEdit: (macro: IMacro) => void
  onDelete: (id: number) => void
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

const MacrosList: FC<Props> = ({ macros, onEdit, onDelete, currentPage, totalPages, onPageChange }) => {
  if (macros.length === 0) {
    return (
      <div className={styles.empty}>
        <Icon icon="chat" iconSize={60} intent={Intent.PRIMARY} />
        <h3>No hay macros configuradas</h3>
        <p>Crea tu primera macro para comenzar a agilizar las respuestas de los agentes.</p>
      </div>
    )
  }

  return (
    <div className={styles.listContainer}>
      <div className={styles.list}>
        {macros.map(macro => (
          <Card key={macro.id} elevation={Elevation.ONE} className={styles.macroCard}>
            <div className={styles.macroHeader}>
              <h4>{macro.name}</h4>
              <div className={styles.actions}>
                <Button icon="edit" minimal small onClick={() => onEdit(macro)} title="Editar" />
                <Button
                  icon="trash"
                  minimal
                  small
                  intent={Intent.DANGER}
                  onClick={() => macro.id && onDelete(macro.id)}
                  title="Eliminar"
                />
              </div>
            </div>
            <div className={styles.macroContent}>
              {macro.content.length > 200 ? macro.content.substring(0, 200) + '...' : macro.content}
            </div>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <Button
            icon="chevron-left"
            minimal
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          />
          <span className={styles.pageInfo}>
            Página {currentPage} de {totalPages}
          </span>
          <Button
            icon="chevron-right"
            minimal
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          />
        </div>
      )}
    </div>
  )
}

export default MacrosList
