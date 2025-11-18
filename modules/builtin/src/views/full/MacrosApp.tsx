import { Button, Intent } from '@blueprintjs/core'
import { AxiosInstance } from 'axios'
import { lang, toast } from 'botpress/shared'
import React, { FC, useEffect, useState } from 'react'

import MacroForm from './components/MacroForm'
import MacrosList from './components/MacrosList'
import styles from './style.scss'

interface Props {
  bp: { axios: AxiosInstance }
  contentLang: string
}

export interface IMacro {
  id?: number
  botId: string
  name: string
  content: string
  created_at?: Date
  updated_at?: Date
}

const MacrosApp: FC<Props> = ({ bp }) => {
  const [macros, setMacros] = useState<IMacro[]>([])
  const [loading, setLoading] = useState(true)
  const [editingMacro, setEditingMacro] = useState<IMacro | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 4

  const loadMacros = async () => {
    try {
      setLoading(true)
      const { data } = await bp.axios.get('/mod/builtin/macros')
      setMacros(data)
    } catch (error) {
      toast.failure(lang.tr('module.builtin.macros.errorLoading'))
      console.error('Error loading macros:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMacros()
  }, [])

  const handleSave = async (macro: IMacro) => {
    try {
      if (macro.id) {
        // Update existing macro
        await bp.axios.put(`/mod/builtin/macros/${macro.id}`, macro)
        toast.success(lang.tr('module.builtin.macros.updateSuccess'))
      } else {
        // Create new macro
        await bp.axios.post('/mod/builtin/macros', macro)
        toast.success(lang.tr('module.builtin.macros.createSuccess'))
      }
      setShowForm(false)
      setEditingMacro(null)
      await loadMacros()
    } catch (error) {
      toast.failure(lang.tr('module.builtin.macros.saveError'))
      console.error('Error saving macro:', error)
    }
  }

  const handleEdit = (macro: IMacro) => {
    setEditingMacro(macro)
    setShowForm(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm(lang.tr('module.builtin.macros.confirmDelete'))) {
      return
    }

    try {
      await bp.axios.delete(`/mod/builtin/macros/${id}`)
      toast.success(lang.tr('module.builtin.macros.deleteSuccess'))
      await loadMacros()
    } catch (error) {
      toast.failure(lang.tr('module.builtin.macros.deleteError'))
      console.error('Error deleting macro:', error)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingMacro(null)
  }

  const handleNewMacro = () => {
    setEditingMacro(null)
    setShowForm(true)
  }

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  if (loading) {
    return <div className={styles.container}>Cargando...</div>
  }

  // Calcular los macros a mostrar en la página actual
  const indexOfLastItem = currentPage * itemsPerPage
  const indexOfFirstItem = indexOfLastItem - itemsPerPage
  const currentMacros = macros.slice(indexOfFirstItem, indexOfLastItem)
  const totalPages = Math.ceil(macros.length / itemsPerPage)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>{lang.tr('module.builtin.macros.title')}</h2>
        <Button
          intent={Intent.PRIMARY}
          icon="add"
          text={lang.tr('module.builtin.macros.newMacro')}
          onClick={handleNewMacro}
        />
      </div>

      {showForm ? (
        <MacroForm macro={editingMacro} onSave={handleSave} onCancel={handleCancel} />
      ) : (
        <MacrosList
          macros={currentMacros}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}

export default MacrosApp
