import axios from 'axios'

export interface ITagCategory {
  id: number
  botId: string
  name: string
  description?: string
  color?: string
  tags?: ITag[]
}

export interface ITag {
  id: number
  categoryId: number
  name: string
  description?: string
}

export const makeClient = (bp: { axios: any }) => {
  const client = bp.axios

  return {
    getCategories: async (): Promise<ITagCategory[]> => {
      const { data } = await client.get('/mod/tag-management/categories')
      return data
    },

    createCategory: async (payload: { name: string; description?: string; color?: string }): Promise<ITagCategory> => {
      const { data } = await client.post('/mod/tag-management/categories', payload)
      return data
    },

    updateCategory: async (id: number, payload: { name?: string; description?: string; color?: string }): Promise<ITagCategory> => {
      const { data } = await client.put(`/mod/tag-management/categories/${id}`, payload)
      return data
    },

    deleteCategory: async (id: number): Promise<void> => {
      await client.delete(`/mod/tag-management/categories/${id}`)
    },

    createTag: async (payload: { categoryId: number; name: string; description?: string }): Promise<ITag> => {
      const { data } = await client.post('/mod/tag-management/tags', payload)
      return data
    },

    updateTag: async (id: number, payload: { name?: string; description?: string }): Promise<ITag> => {
      const { data } = await client.put(`/mod/tag-management/tags/${id}`, payload)
      return data
    },

    deleteTag: async (id: number): Promise<void> => {
      await client.delete(`/mod/tag-management/tags/${id}`)
    }
  }
}

export type TagManagementClient = ReturnType<typeof makeClient>
