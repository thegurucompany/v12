export interface ITagCategory {
  id: number
  botId: string
  name: string
  description?: string
  color?: string
  createdAt: Date
  updatedAt: Date
  tags?: ITag[]
}

export interface ITag {
  id: number
  categoryId: number
  name: string
  description?: string
  createdAt: Date
  updatedAt: Date
  category?: ITagCategory
}

export interface IHandoffTag {
  id: number
  handoffId: number
  tagId: number
  createdAt: Date
  tag?: ITag
}

export interface CreateCategoryPayload {
  name: string
  description?: string
  color?: string
}

export interface UpdateCategoryPayload {
  name?: string
  description?: string
  color?: string
}

export interface CreateTagPayload {
  categoryId: number
  name: string
  description?: string
}

export interface UpdateTagPayload {
  name?: string
  description?: string
}
