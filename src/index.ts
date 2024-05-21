import {
  persistentAtom,
  type PersistentEvent,
  type PersistentListener,
  setPersistentEngine,
} from '@nanostores/persistent'
import { useStore as useNanostore } from '@nanostores/react'
import Cookies from 'js-cookie'
import cloneDeep from 'lodash/clonedeep.js'
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
type CreateStorikOptionsWithoutSchema<TStorikStore extends StorikStore = StorikStore> = {
  projectSlug?: string
  persistent?: string | false
  defaultValue: TStorikStore
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => TStorikStore
  encode?: (value: TStorikStore) => string
}
type CreateStorikOptionsWithSchema<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: TSchema
  defaultValue: z.infer<TSchema>
  projectSlug?: string
  persistent?: string | false
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => z.infer<TSchema>
  encode?: (value: z.infer<TSchema>) => string
}
type CreateStorikOptions = CreateStorikOptionsWithoutSchema | CreateStorikOptionsWithSchema
type CreateStorik = {
  <TStorikStore extends StorikStore>(
    options: CreateStorikOptionsWithoutSchema<TStorikStore>
  ): {
    useStore: () => TStorikStore
    getStore: () => TStorikStore
    resetStore: (value?: Partial<TStorikStore>) => void
    updateStore: (value: Partial<TStorikStore>) => void
  }
  <TSchema extends z.ZodTypeAny>(
    options: CreateStorikOptionsWithSchema<TSchema>
  ): {
    useStore: () => z.infer<TSchema>
    getStore: () => z.infer<TSchema>
    resetStore: (value?: Partial<z.infer<TSchema>>) => void
    updateStore: (value: Partial<z.infer<TSchema>>) => void
  }
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

  const store = (() => {
    if (!persistentKey) {
      return atom(options.defaultValue)
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
    const storeValue = store.get()
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
    store.set({ ...options.defaultValue, ...value })
  }
  const updateStore = (value: StorikStore) => {
    store.set({ ...store.get(), ...value })
  }
  return {
    useStore,
    getStore,
    resetStore,
    updateStore,
  }
}

type StorikPrimitiveStore = string | number | boolean | undefined | null
type CreateStorikPrimitiveOptionsWithoutSchema<
  TStorikPrimitiveStore extends StorikPrimitiveStore = StorikPrimitiveStore,
> = {
  defaultValue: TStorikPrimitiveStore
  projectSlug?: string
  persistent?: string | false
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => TStorikPrimitiveStore
  encode?: (value: TStorikPrimitiveStore) => string
}
type CreateStorikPrimitiveOptionsWithSchema<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  projectSlug?: string
  persistent?: string | false
  schema: TSchema
  defaultValue: z.infer<TSchema>
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => z.infer<TSchema>
  encode?: (value: z.infer<TSchema>) => string
}
type CreateStorikPrimitiveOptions = CreateStorikPrimitiveOptionsWithoutSchema | CreateStorikPrimitiveOptionsWithSchema
type CreateStorikPrimitive = {
  <TStorikPrimitiveStore extends StorikPrimitiveStore>(
    options: CreateStorikPrimitiveOptionsWithoutSchema<TStorikPrimitiveStore>
  ): {
    useStore: () => TStorikPrimitiveStore
    getStore: () => TStorikPrimitiveStore
    resetStore: () => void
    updateStore: (value: TStorikPrimitiveStore) => void
  }
  <TSchema extends z.ZodTypeAny>(
    options: CreateStorikPrimitiveOptionsWithSchema<TSchema>
  ): {
    useStore: () => z.infer<TSchema>
    getStore: () => z.infer<TSchema>
    resetStore: () => void
    updateStore: (value: z.infer<TSchema>) => void
  }
}
export const createStorikPrimitive: CreateStorikPrimitive = (options: {
  projectSlug?: string
  persistent?: string | false
  schema?: z.ZodTypeAny
  defaultValue: any
  useServerPersistentStore?: () => Record<string, any>
  decode?: (value: string) => any
  encode?: (value: any) => string
}) => {
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

  const store = (() => {
    if (!persistentKey) {
      return atom(options.defaultValue)
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
    const storeValue = store.get()
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
  }
  const updateStore = (value: any) => {
    store.set(value)
  }
  return {
    useStore,
    getStore,
    resetStore,
    updateStore,
  }
}

export const createStorikThings = ({
  projectSlug,
  useServerPersistentStore,
}: {
  projectSlug?: string
  useServerPersistentStore?: () => Record<string, any>
}) => {
  const createStorikHere: typeof createStorik = (options: CreateStorikOptions) => {
    return createStorik({ projectSlug, useServerPersistentStore, ...options })
  }
  const createStorikPrimitiveHere: typeof createStorikPrimitive = (options: CreateStorikPrimitiveOptions) => {
    return createStorikPrimitive({ projectSlug, useServerPersistentStore, ...options })
  }

  return {
    createStorik: createStorikHere,
    createStorikPrimitive: createStorikPrimitiveHere,
  }
}
