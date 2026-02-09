# Migraciones manuales para setup local

Cuando se clona un bot de produccion y se corre localmente con SQLite, las siguientes migraciones no se aplican automaticamente y deben ejecutarse manualmente.

## Base de datos SQLite

Ubicacion: `packages/bp/dist/data/storage/core.sqlite`

## Migraciones necesarias

### 1. hitl_messages: agregar columna `messageId`

La tabla `hitl_messages` se crea sin la columna `messageId`, pero el codigo en `hitl/src/backend/db.ts` (funcion `appendMessageToSession`) la requiere para guardar el UUID del mensaje del messaging server.

```sql
ALTER TABLE hitl_messages ADD COLUMN messageId varchar(255);
```

**Error si falta:**
```
SQLITE_ERROR: table hitl_messages has no column named messageId
```

### 2. hitl_sessions: agregar columna `user_type`

La tabla `hitl_sessions` se crea sin `user_type`, pero la accion `utoppia.js` la usa para clasificar usuarios como 'cliente' o 'Colaborador' y actualizar la sesion HITL.

```sql
ALTER TABLE hitl_sessions ADD COLUMN user_type varchar(255) DEFAULT 'cliente';
```

**Error si falta:**
```
SQLITE_ERROR: no such column: user_type
```

## Script rapido

Para aplicar todas las migraciones de una vez:

```bash
DB_PATH="packages/bp/dist/data/storage/core.sqlite"

sqlite3 "$DB_PATH" "ALTER TABLE hitl_messages ADD COLUMN messageId varchar(255);"
sqlite3 "$DB_PATH" "ALTER TABLE hitl_sessions ADD COLUMN user_type varchar(255) DEFAULT 'cliente';"
```

> **Nota:** Si la columna ya existe, SQLite arrojara un error `duplicate column name` que se puede ignorar.
