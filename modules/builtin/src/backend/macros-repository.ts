import * as sdk from 'botpress/sdk'
import Knex from 'knex'
import _ from 'lodash'

export interface IMacro {
  id?: number
  botId: string
  name: string
  content: string
  created_at?: Date
  updated_at?: Date
}

const MACROS_TABLE = 'hln_macros'

export default class MacrosRepository {
  constructor(private bp: typeof sdk) {}

  async createMacro(macro: IMacro): Promise<IMacro> {
    const serialized = {
      ...macro,
      created_at: this.bp.database.date.now(),
      updated_at: this.bp.database.date.now()
    }

    const [result] = await this.bp
      .database(MACROS_TABLE)
      .insert(serialized)
      .returning('*')

    return result as IMacro
  }

  async getMacrosByBot(botId: string): Promise<IMacro[]> {
    return this.bp.database
      .select('*')
      .from(MACROS_TABLE)
      .where({ botId })
      .orderBy('created_at', 'desc')
  }

  async getMacroById(id: number, botId: string): Promise<IMacro | undefined> {
    const result = await this.bp.database
      .select('*')
      .from(MACROS_TABLE)
      .where({ id, botId })
      .first()

    return result
  }

  async updateMacro(id: number, botId: string, updates: Partial<IMacro>): Promise<boolean> {
    const serialized = {
      ...updates,
      updated_at: this.bp.database.date.now()
    }

    const count = await this.bp
      .database(MACROS_TABLE)
      .where({ id, botId })
      .update(serialized)

    return count > 0
  }

  async deleteMacro(id: number, botId: string): Promise<boolean> {
    const count = await this.bp
      .database(MACROS_TABLE)
      .where({ id, botId })
      .del()

    return count > 0
  }
}
