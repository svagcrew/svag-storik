import {
  persistentAtom,
  type PersistentEvent,
  type PersistentListener,
  setPersistentEngine,
} from '@nanostores/persistent'
import { useStore as useNanostore } from '@nanostores/react'
import Cookies from 'js-cookie'
import cloneDeep from 'lodash/cloneDeep.js'
import { atom } from 'nanostores'
import type z from 'zod'

const isCookiesEnabled = () => {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return false
  }
  const cookieEnabled = navigator.cookieEnabled
  if (cookieEnabled) {
    return true
  }
  // eslint-disable-next-line unicorn/no-document-cookie
  document.cookie = 'testcookie'
  return document.cookie.includes('testcookie')
}

const isLocalStorageEnabled = () => {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    localStorage.setItem('test', 'test')
    localStorage.removeItem('test')
    return true
  } catch {
    return false
  }
}

let listeners: PersistentListener[] = []
const onChange = (key: string, newValue: any) => {
  const event: PersistentEvent = { key, newValue }
  for (const listener of listeners) {
    listener(event)
  }
}

const getFromStorage = (key: string) => {
  if (isCookiesEnabled()) {
    return Cookies.get(key)
  }
  if (isLocalStorageEnabled()) {
    return localStorage.getItem(key)
  }
  return undefined
}

const setToStorage = (key: string, value: any) => {
  if (isCookiesEnabled()) {
    Cookies.set(key, value, { expires: 99_999 })
  }
  if (isLocalStorageEnabled()) {
    localStorage.setItem(key, value)
  }
}

const removeFromStorage = (key: string) => {
  if (isCookiesEnabled()) {
    Cookies.remove(key)
  }
  if (isLocalStorageEnabled()) {
    localStorage.removeItem(key)
  }
}

// Must implement storage[key] = value, storage[key], and delete storage[key]
const storage = new Proxy(
  {},
  {
    set(target: Record<string, any>, name: string, value: any) {
      setToStorage(name, value)
      // target[name] = value
      onChange(name, value)
      return true
    },
    get(target: Record<string, any>, name: string) {
      // return getFromStorage(name) || target[name]
      return getFromStorage(name)
    },
    deleteProperty(target: Record<string, any>, name: string) {
      removeFromStorage(name)
      // delete target[name]
      onChange(name, undefined)
      return true
    },
  }
)

// Must implement addEventListener and removeEventListener
const events = {
  addEventListener(key: string, callback: PersistentListener) {
    listeners.push(callback)
  },
  removeEventListener(key: string, callback: PersistentListener) {
    listeners = listeners.filter((listener) => listener !== callback)
  },
  // window dispatches "storage" events for any key change
  // => One listener for all map keys is enough
  perKey: false,
}

setPersistentEngine(storage, events)

type StorikStore = Record<string, any>
type CreateStorikOptionsWithoutSchema<
  TStorikStore extends StorikStore = StorikStore,
  TPersistentKey extends string | false = string | false,
> = {
  projectSlug?: string
  persistent?: TPersistentKey
  defaultValue: TStorikStore
  overridePersistentGet?: (persistentKey: string) => TStorikStore
  onPersistentSet?: (persistentKey: string, value: TStorikStore) => any
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => TStorikStore
  encode?: (value: TStorikStore) => string
}
type CreateStorikOptionsWithSchema<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TPersistentKey extends string | false = string | false,
> = {
  schema: TSchema
  defaultValue: z.infer<TSchema>
  overridePersistentGet?: (persistentKey: string) => z.infer<TSchema>
  onPersistentSet?: (persistentKey: string, value: z.infer<TSchema>) => any
  projectSlug?: string
  persistent?: TPersistentKey
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => z.infer<TSchema>
  encode?: (value: z.infer<TSchema>) => string
}
type CreateStorikOptions = CreateStorikOptionsWithoutSchema | CreateStorikOptionsWithSchema
type StorikWithoutSchema<
  TStorikStore extends StorikStore = StorikStore,
  TPersistentKey extends string | false = string | false,
> = {
  persistentKey: TPersistentKey
  nanostore: ReturnType<typeof atom<TStorikStore>>
  schema: null
  defaultValue: TStorikStore
  overridePersistentGet?: (persistentKey: string) => TStorikStore
  onPersistentSet?: (persistentKey: string, value: TStorikStore) => any
  decode: (value: string) => TStorikStore
  encode: (value: TStorikStore) => string
  useStore: () => TStorikStore
  getStore: () => TStorikStore
  resetStore: (value?: Partial<TStorikStore>) => void
  updateStore: (value: Partial<TStorikStore>) => void
}
type StorikWithSchema<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TPersistentKey extends string | false = string | false,
> = {
  persistentKey: TPersistentKey
  nanostore: ReturnType<typeof atom<z.infer<TSchema>>>
  schema: TSchema
  defaultValue: z.infer<TSchema>
  overridePersistentGet?: (persistentKey: string) => z.infer<TSchema>
  onPersistentSet?: (persistentKey: string, value: z.infer<TSchema>) => any
  decode: (value: string) => z.infer<TSchema>
  encode: (value: z.infer<TSchema>) => string
  useStore: () => z.infer<TSchema>
  getStore: () => z.infer<TSchema>
  resetStore: (value?: Partial<z.infer<TSchema>>) => void
  updateStore: (value: Partial<z.infer<TSchema>>) => void
}
type CreateStorik = {
  <TStorikStore extends StorikStore = StorikStore, TPersistentKey extends string | false = string | false>(
    options: CreateStorikOptionsWithoutSchema<TStorikStore>
  ): StorikWithoutSchema<TStorikStore, TPersistentKey>
  <TSchema extends z.ZodTypeAny = z.ZodTypeAny, TPersistentKey extends string | false = string | false>(
    options: CreateStorikOptionsWithSchema<TSchema>
  ): StorikWithSchema<TSchema, TPersistentKey>
}
export const createStorik: CreateStorik = (options: CreateStorikOptions) => {
  const schema = 'schema' in options ? options.schema : null

  const persistentKey =
    options.projectSlug && options.persistent
      ? `${options.projectSlug}-${options.persistent}`
      : options.persistent
        ? options.persistent
        : false

  const decode =
    options.decode ||
    ((value) => {
      try {
        return JSON.parse(value)
      } catch {
        return cloneDeep(options.defaultValue)
      }
    })

  const encode =
    options.encode ||
    ((value: any) => {
      return JSON.stringify(value)
    })

  const overridePersistentGet = options.overridePersistentGet
  const onPersistentSet = options.onPersistentSet

  const store = (() => {
    if (!persistentKey) {
      return atom(options.defaultValue)
    }
    if (overridePersistentGet) {
      return atom(overridePersistentGet?.(persistentKey) || options.defaultValue)
    }
    return persistentAtom(persistentKey, options.defaultValue, {
      encode(value) {
        return encode(value)
      },
      decode(value) {
        const rawValue = decode(value)
        if (!schema) {
          return rawValue
        }
        try {
          return schema.parse(rawValue)
        } catch {
          return schema.parse(cloneDeep(options.defaultValue))
        }
      },
    })
  })()
  const getStore = () => {
    const storeValue =
      (persistentKey && overridePersistentGet ? overridePersistentGet(persistentKey) : store.get()) ||
      options.defaultValue
    if (!schema) {
      return storeValue
    }
    try {
      return schema.parse(storeValue)
    } catch {
      return schema.parse(cloneDeep(options.defaultValue))
    }
  }
  const useStore = () => {
    const serverPersistentStore = persistentKey && typeof window === 'undefined' && options.useServerPersistentStore?.()
    if (serverPersistentStore) {
      return (() => {
        const stringValue = serverPersistentStore[persistentKey]
        if (!stringValue) {
          return cloneDeep(options.defaultValue)
        }
        const rawValue = decode(stringValue)
        if (!schema) {
          return rawValue
        }
        try {
          return schema.parse(rawValue)
        } catch {
          return schema.parse(cloneDeep(options.defaultValue))
        }
      })()
    }
    return useNanostore(store)
  }
  const resetStore = (value?: StorikStore) => {
    const newStore = { ...options.defaultValue, ...value }
    store.set(newStore)
    persistentKey && onPersistentSet?.(persistentKey, newStore)
  }
  const updateStore = (value: StorikStore) => {
    const currentStore =
      (persistentKey && overridePersistentGet ? overridePersistentGet(persistentKey) : store.get()) ||
      options.defaultValue
    const newStore = { ...currentStore, ...value }
    store.set(newStore)
    persistentKey && onPersistentSet?.(persistentKey, newStore)
  }
  return {
    persistentKey: persistentKey || null,
    nanostore: store,
    schema: schema as any,
    defaultValue: options.defaultValue,
    decode,
    encode,
    useStore,
    getStore,
    resetStore,
    updateStore,
  }
}

type StorikPrimitiveStore = string | number | boolean | undefined | null
type CreateStorikPrimitiveOptionsWithoutSchema<
  TStorikPrimitiveStore extends StorikPrimitiveStore = StorikPrimitiveStore,
  TPersistentKey extends string | false = string | false,
> = {
  defaultValue: TStorikPrimitiveStore
  projectSlug?: string
  persistent?: TPersistentKey
  overridePersistentGet?: (persistentKey: string) => TStorikPrimitiveStore
  onPersistentSet?: (persistentKey: string, value: TStorikPrimitiveStore) => any
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => TStorikPrimitiveStore
  encode?: (value: TStorikPrimitiveStore) => string
}
type CreateStorikPrimitiveOptionsWithSchema<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TPersistentKey extends string | false = string | false,
> = {
  projectSlug?: string
  persistent?: TPersistentKey
  overridePersistentGet?: (persistentKey: string) => z.infer<TSchema>
  onPersistentSet?: (persistentKey: string, value: z.infer<TSchema>) => any
  schema: TSchema
  defaultValue: z.infer<TSchema>
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => z.infer<TSchema>
  encode?: (value: z.infer<TSchema>) => string
}
type CreateStorikPrimitiveOptions = CreateStorikPrimitiveOptionsWithoutSchema | CreateStorikPrimitiveOptionsWithSchema
type StorikPrimitiveWithoutSchema<
  TStorikPrimitiveStore extends StorikPrimitiveStore = StorikPrimitiveStore,
  TPersistentKey extends string | false = false,
> = {
  persistentKey: TPersistentKey
  nanostore: ReturnType<typeof atom<TStorikPrimitiveStore>>
  schema: null
  defaultValue: TStorikPrimitiveStore
  decode: (value: string) => TStorikPrimitiveStore
  encode: (value: TStorikPrimitiveStore) => string
  useStore: () => TStorikPrimitiveStore
  getStore: () => TStorikPrimitiveStore
  resetStore: () => void
  updateStore: (value: TStorikPrimitiveStore) => void
}
type StorikPrimitiveWithSchema<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TPersistentKey extends string | false = false,
> = {
  persistentKey: TPersistentKey
  nanostore: ReturnType<typeof atom<z.infer<TSchema>>>
  schema: TSchema
  defaultValue: z.infer<TSchema>
  decode: (value: string) => z.infer<TSchema>
  encode: (value: z.infer<TSchema>) => string
  useStore: () => z.infer<TSchema>
  getStore: () => z.infer<TSchema>
  resetStore: () => void
  updateStore: (value: z.infer<TSchema>) => void
}
type CreateStorikPrimitive = {
  <
    TStorikPrimitiveStore extends StorikPrimitiveStore = StorikPrimitiveStore,
    TPersistentKey extends string | false = false,
  >(
    options: CreateStorikPrimitiveOptionsWithoutSchema<TStorikPrimitiveStore, TPersistentKey>
  ): StorikPrimitiveWithoutSchema<TStorikPrimitiveStore, TPersistentKey>
  <TSchema extends z.ZodTypeAny = z.ZodTypeAny, TPersistentKey extends string | false = false>(
    options: CreateStorikPrimitiveOptionsWithSchema<TSchema, TPersistentKey>
  ): StorikPrimitiveWithSchema<TSchema, TPersistentKey>
}
export const createStorikPrimitive: CreateStorikPrimitive = (options: {
  projectSlug?: string
  persistent?: string | false
  schema?: z.ZodTypeAny
  defaultValue: any
  overridePersistentGet?: (persistentKey: string) => any
  onPersistentSet?: (persistentKey: string, value: any) => any
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => any
  encode?: (value: any) => string
}) => {
  const schema = 'schema' in options ? options.schema || null : null

  const persistentKey =
    options.projectSlug && options.persistent
      ? `${options.projectSlug}-${options.persistent}`
      : options.persistent
        ? options.persistent
        : false

  const decode =
    options.decode ||
    ((value) => {
      try {
        return JSON.parse(value)
      } catch {
        return cloneDeep(options.defaultValue)
      }
    })

  const encode =
    options.encode ||
    ((value) => {
      return JSON.stringify(value)
    })

  const overridePersistentGet = options.overridePersistentGet
  const onPersistentSet = options.onPersistentSet

  const store = (() => {
    if (!persistentKey) {
      return atom(options.defaultValue)
    }
    if (overridePersistentGet && persistentKey) {
      return atom(overridePersistentGet(persistentKey) || options.defaultValue)
    }
    return persistentAtom(persistentKey, options.defaultValue, {
      encode(value) {
        return encode(value)
      },
      decode(value) {
        const rawValue = decode(value)
        if (!options.schema) {
          return rawValue
        }
        try {
          return options.schema.parse(rawValue)
        } catch {
          return options.schema.parse(cloneDeep(options.defaultValue))
        }
      },
    })
  })()
  const getStore = () => {
    const storeValue = overridePersistentGet && persistentKey ? overridePersistentGet(persistentKey) : store.get()
    if (!options.schema) {
      return storeValue
    }
    try {
      return options.schema.parse(storeValue)
    } catch {
      return options.schema.parse(cloneDeep(options.defaultValue))
    }
  }
  const useStore = () => {
    const serverPersistentStore = persistentKey && typeof window === 'undefined' && options.useServerPersistentStore?.()
    if (serverPersistentStore) {
      return (() => {
        const stringValue = serverPersistentStore[persistentKey]
        if (!stringValue) {
          return cloneDeep(options.defaultValue)
        }
        const rawValue = decode(stringValue)
        if (!options.schema) {
          return rawValue
        }
        try {
          return options.schema.parse(rawValue)
        } catch {
          return options.schema.parse(cloneDeep(options.defaultValue))
        }
      })()
    }
    return useNanostore(store)
  }
  const resetStore = () => {
    store.set(options.defaultValue)
    persistentKey && onPersistentSet?.(persistentKey, options.defaultValue)
  }
  const updateStore = (value: any) => {
    store.set(value)
    persistentKey && onPersistentSet?.(persistentKey, value)
  }
  return {
    persistentKey: persistentKey || null,
    nanostore: store,
    schema: schema as any,
    defaultValue: options.defaultValue,
    decode,
    encode,
    useStore,
    getStore,
    resetStore,
    updateStore,
  }
}

export type Storik = StorikWithSchema | StorikWithoutSchema
export type StorikPersistent = StorikWithSchema<any, string> | StorikWithoutSchema<any, string>
export type StorikPrimitive = StorikPrimitiveWithSchema | StorikPrimitiveWithoutSchema
export type StorikPrimitivePersistent =
  | StorikPrimitiveWithSchema<any, string>
  | StorikPrimitiveWithoutSchema<any, string>
export type StorikAny = Storik | StorikPrimitive
export type StroikAnyPersistent = StorikPersistent | StorikPrimitivePersistent

export const createStorikClientThings = ({
  projectSlug,
  useServerPersistentStore,
  overridePersistentGet,
  onPersistentSet,
  onCreateStorik,
}: {
  projectSlug?: string
  useServerPersistentStore?: () => Record<string, any>
  overridePersistentGet?: (persistentKey: string) => any
  onPersistentSet?: (persistentKey: string, value: any) => any
  onCreateStorik?: (storik: StorikAny | StroikAnyPersistent) => any
}) => {
  const createStorikHere: typeof createStorik = (options: CreateStorikOptions) => {
    const createStorikOptions = {
      projectSlug,
      useServerPersistentStore,
      overridePersistentGet,
      onPersistentSet,
      ...options,
    }
    const storik = createStorik(createStorikOptions)
    onCreateStorik?.(storik)
    return storik
  }
  const createStorikPrimitiveHere: typeof createStorikPrimitive = (options: CreateStorikPrimitiveOptions) => {
    const createStorikOptions = {
      projectSlug,
      useServerPersistentStore,
      overridePersistentGet,
      onPersistentSet,
      ...options,
    }
    const storik = createStorikPrimitive(createStorikOptions)
    onCreateStorik?.(storik as any)
    return storik
  }

  return {
    createStorik: createStorikHere,
    createStorikPrimitive: createStorikPrimitiveHere,
  }
}
